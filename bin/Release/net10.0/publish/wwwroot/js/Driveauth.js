// wwwroot/js/driveAuth.js
//
// Requiere el script de Google Identity Services cargado antes que este archivo:
// <script src="https://accounts.google.com/gsi/client" async defer></script>

window.driveAuth = (() => {
    // =========================================================
    // PEGA AQUÍ TU CLIENT ID DE GOOGLE CLOUD CONSOLE
    // =========================================================
    const CLIENT_ID = "745002194169-gq3h30lbsg2sgndpumv4ko4sa6pjq7kp.apps.googleusercontent.com";

    const SCOPES = [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.appdata"
    ].join(" ");

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

    // ---------- Listar cómics ----------

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

    // ---------- Progreso (guardado como JSON en appDataFolder) ----------

    async function findProgressFileId() {
        const params = new URLSearchParams({
            q: `name = '${PROGRESS_FILE_NAME}' and trashed = false`,
            spaces: "appDataFolder",
            fields: "files(id)"
        });

        const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
            headers: authHeaders()
        });

        if (!res.ok) throw new Error("Error buscando progreso.json: " + res.status);

        const data = await res.json();
        return data.files.length > 0 ? data.files[0].id : null;
    }

    async function readProgressData() {
        const fileId = await findProgressFileId();
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

    async function writeProgressData(data) {
        const fileId = await findProgressFileId();
        const content = JSON.stringify(data);
        const blob = new Blob([content], { type: "application/json" });

        if (fileId) {
            // Actualizar archivo existente
            await fetch(
                `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
                {
                    method: "PATCH",
                    headers: { ...authHeaders(), "Content-Type": "application/json" },
                    body: blob
                }
            );
        } else {
            // Crear archivo nuevo dentro de appDataFolder
            const metadata = { name: PROGRESS_FILE_NAME, parents: ["appDataFolder"] };
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

    async function getProgress(fileId) {
        const data = await readProgressData();
        return data[fileId]?.pagina ?? 0;
    }

    async function saveProgress(fileId, page) {
        const data = await readProgressData();
        data[fileId] = { pagina: page };
        await writeProgressData(data);
    }

    return { signIn, isSignedIn, listComics, openComic, getProgress, saveProgress };
})();