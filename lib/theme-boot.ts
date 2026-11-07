export const THEME_KEY = "altron-theme";

/** Runs before first paint (inlined in <head>) so the page never flashes the wrong theme. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t}catch(e){document.documentElement.dataset.theme='dark'}})();`;
