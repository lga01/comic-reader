// wwwroot/js/readerUtils.js

window.readerUtils = {
    toggleFullscreen: async (elementId) => {
        const el = document.getElementById(elementId);
        if (!document.fullscreenElement) {
            if (el && el.requestFullscreen) {
                await el.requestFullscreen();
            }
            return true;
        } else {
            await document.exitFullscreen();
            return false;
        }
    }
};