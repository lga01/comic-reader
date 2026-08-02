// wwwroot/js/comicReader.js
//
// Requiere que el navegador soporte la File System Access API
// (Chrome, Edge, y otros basados en Chromium). Firefox y Safari NO
// la soportan todavía, así que para pruebas locales usa Chrome o Edge.

window.comicReader = (() => {
    let folderHandle = null;
    let fileHandles = {};       // nombre de archivo -> FileSystemFileHandle
    let currentPageUrls = [];   // blob URLs de la página actualmente abiertos

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

    async function pickFolder() {
        if (!window.showDirectoryPicker) {
            alert("Tu navegador no soporta seleccionar carpetas locales. Usa Chrome o Edge.");
            return [];
        }

        try {
            folderHandle = await window.showDirectoryPicker();
        } catch (e) {
            // El usuario canceló el selector de carpetas
            return [];
        }

        fileHandles = {};
        const names = [];
        for await (const entry of folderHandle.values()) {
            if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".cbz")) {
                fileHandles[entry.name] = entry;
                names.push(entry.name);
            }
        }

        names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        return names;
    }

    async function openComic(fileName) {
        const handle = fileHandles[fileName];
        if (!handle) return [];

        const file = await handle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        const imageEntries = [];
        zip.forEach((relativePath, entry) => {
            if (!entry.dir && /\.(jpe?g|png|gif|webp|bmp)$/i.test(relativePath)) {
                imageEntries.push(entry);
            }
        });

        // Orden natural (para que la página 2 vaya antes que la 10, etc.)
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

    function saveProgress(comicName, page) {
        localStorage.setItem("comic-progress:" + comicName, page.toString());
    }

    function getProgress(comicName) {
        const value = localStorage.getItem("comic-progress:" + comicName);
        return value ? parseInt(value, 10) : 0;
    }

    return { pickFolder, openComic, saveProgress, getProgress };
})();