// wwwroot/js/driveAuth.js
//
// Requiere el script de Google Identity Services cargado antes que este archivo:
// <script src="https://accounts.google.com/gsi/client" async defer></script>

window.driveAuth = (() => {
    // =========================================================
    // PEGA AQUÍ TU CLIENT ID DE GOOGLE CLOUD CONSOLE
    // =========================================================
    const CLIENT_ID = "745002194169-gq3h30lbsg2sgndpumv4ko4sa6pjq7kp.apps.googleusercontent.com";

    // Acceso completo de lectura/escritura a Drive: hace falta para poder
    // crear/actualizar progreso.json dentro de las carpetas normales
    // (drive.readonly ya no basta, porque solo permite leer).
    const SCOPES = "https://www.googleapis.com/auth/drive";

    const PROGRESS_FILE_NAME = "progreso.json";

    let tokenClient = null;
    let accessToken = null;
    let currentPageUrls = [];

    function ensureTokenClient() {
        if (tokenClient) return;
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: () => {} // se sobreescribe en cada llamada a signIn()
        });
    }

    function signIn() {
        ensureTokenClient();
        return new Promise((resolve, reject) => {
            tokenClient.callback = (response) => {
                if (response.error) {
                    reject(response);
                    return;
                }
                accessToken = response.access_token;
                resolve(true);
            };
            tokenClient.requestAccessToken({ prompt: "select_account" });
        });
    }

    function isSignedIn() {
        return accessToken !== null;
    }

    function authHeaders() {
        return { Authorization: "Bearer " + accessToken };
    }

    // ---------- Listar cómics (plano, sin categorías) ----------

    async function listComics() {
        const params = new URLSearchParams({
            q: "name contains '.cbz' and trashed = false",
            fields: "files(id, name, size)",
            pageSize: "200",
            orderBy: "name"
        });

        const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
            headers: authHeaders()
        });

        if (!res.ok) throw new Error("Error listando archivos de Drive: " + res.status);

        const data = await res.json();
        return data.files.map(f => ({ id: f.id, name: f.name }));
    }

    // ---------- Listar cómics agrupados por categoría (subcarpeta de "Comics") ----------

    async function listComicsByCategory() {
        try {
            console.log("=== INICIO listComicsByCategory ===");

            // 1. Buscar carpeta Comics
            const rootQuery =
                "name = 'Comics' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";

            const rootRes = await fetch(
                "https://www.googleapis.com/drive/v3/files?" +
                new URLSearchParams({ q: rootQuery, fields: "files(id,name)" }),
                { headers: authHeaders() }
            );

            const rootData = await rootRes.json();

            if (!rootData.files?.length) {
                console.warn("NO se encontró la carpeta Comics");
                return [];
            }

            const comicsFolder = rootData.files[0];

            // 2. Buscar subcarpetas (categorías)
            const foldersQuery =
                `'${comicsFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

            const foldersRes = await fetch(
                "https://www.googleapis.com/drive/v3/files?" +
                new URLSearchParams({
                    q: foldersQuery,
                    fields: "files(id,name)",
                    pageSize: "200",
                    orderBy: "name"
                }),
                { headers: authHeaders() }
            );

            const foldersData = await foldersRes.json();
            const result = [];

            for (const folder of foldersData.files ?? []) {
                const comicsQuery =
                    `'${folder.id}' in parents and name contains '.cbz' and trashed = false`;

                const comicsRes = await fetch(
                    "https://www.googleapis.com/drive/v3/files?" +
                    new URLSearchParams({
                        q: comicsQuery,
                        fields: "files(id,name)",
                        pageSize: "500",
                        orderBy: "name"
                    }),
                    { headers: authHeaders() }
                );

                const comicsData = await comicsRes.json();

                // Progreso guardado en la carpeta de esta categoría
                const progress = await readFolderProgress(folder.id);

                const comicsWithProgress = (comicsData.files ?? [])
                    .map(f => {
                        const p = progress[f.name];
                        return {
                            id: f.id,
                            name: f.name,
                            leido: p ? !!p.leido : false,
                            pagina: (p && p.pagina != null) ? p.pagina : null,
                            totalPaginas: (p && p.totalPaginas != null) ? p.totalPaginas : null
                        };
                    })
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

                result.push({
                    folderId: folder.id,
                    name: folder.name,
                    comics: comicsWithProgress
                });
            }

            console.log("Resultado final:", result);
            console.log("=== FIN listComicsByCategory ===");

            return result;
        }
        catch (err) {
            console.error("ERROR listComicsByCategory:", err);
            throw err;
        }
    }

    // ---------- Abrir y leer un cómic ----------

    function guessMime(name) {
        const ext = name.split(".").pop().toLowerCase();
        switch (ext) {
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "png": return "image/png";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "bmp": return "image/bmp";
            default: return "application/octet-stream";
        }
    }

    function revokeCurrentUrls() {
        for (const url of currentPageUrls) {
            URL.revokeObjectURL(url);
        }
        currentPageUrls = [];
    }

    async function openComic(fileId) {
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            { headers: authHeaders() }
        );

        if (!res.ok) throw new Error("Error descargando el cómic: " + res.status);

        const arrayBuffer = await res.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        const imageEntries = [];
        zip.forEach((relativePath, entry) => {
            if (!entry.dir && /\.(jpe?g|png|gif|webp|bmp)$/i.test(relativePath)) {
                imageEntries.push(entry);
            }
        });

        imageEntries.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
        );

        revokeCurrentUrls();

        for (const entry of imageEntries) {
            const data = await entry.async("uint8array");
            const blob = new Blob([data], { type: guessMime(entry.name) });
            currentPageUrls.push(URL.createObjectURL(blob));
        }

        return currentPageUrls;
    }

    // ---------- Progreso: un progreso.json por carpeta de categoría ----------

    async function findProgressFileId(folderId) {
        const params = new URLSearchParams({
            q: `name = '${PROGRESS_FILE_NAME}' and '${folderId}' in parents and trashed = false`,
            fields: "files(id)"
        });

        const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
            headers: authHeaders()
        });

        if (!res.ok) throw new Error("Error buscando progreso.json: " + res.status);
        const data = await res.json();
        return data.files.length > 0 ? data.files[0].id : null;
    }

    async function readFolderProgress(folderId) {
        const fileId = await findProgressFileId(folderId);
        if (!fileId) return {};

        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            { headers: authHeaders() }
        );
        if (!res.ok) return {};

        try {
            return await res.json();
        } catch {
            return {};
        }
    }

    async function writeFolderProgress(folderId, data) {
        const fileId = await findProgressFileId(folderId);
        const content = JSON.stringify(data, null, 2);
        const blob = new Blob([content], { type: "application/json" });

        if (fileId) {
            await fetch(
                `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
                {
                    method: "PATCH",
                    headers: { ...authHeaders(), "Content-Type": "application/json" },
                    body: blob
                }
            );
        } else {
            const metadata = { name: PROGRESS_FILE_NAME, parents: [folderId] };
            const form = new FormData();
            form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
            form.append("file", blob);

            await fetch(
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
                {
                    method: "POST",
                    headers: authHeaders(),
                    body: form
                }
            );
        }
    }

    async function getComicProgress(folderId, comicName) {
        const data = await readFolderProgress(folderId);
        return data[comicName] || null;
    }

    // Se llama cada vez que el usuario cambia de página leyendo un cómic
    async function saveComicPage(folderId, comicName, page, totalPages) {
        const data = await readFolderProgress(folderId);
        const leido = (page + 1) >= totalPages;
        data[comicName] = { leido, pagina: page, totalPaginas: totalPages };
        await writeFolderProgress(folderId, data);
    }

    // Se llama al pulsar el botón de marcar leído/no leído a mano
    async function setComicRead(folderId, comicName, leido) {
        const data = await readFolderProgress(folderId);
        const existing = data[comicName] || {};
        const updated = { ...existing, leido };
        if (leido && existing.totalPaginas) {
            updated.pagina = existing.totalPaginas - 1;
        }
        data[comicName] = updated;
        await writeFolderProgress(folderId, data);
    }

    return {
        signIn,
        isSignedIn,
        listComics,
        listComicsByCategory,
        openComic,
        getComicProgress,
        saveComicPage,
        setComicRead
    };
})();