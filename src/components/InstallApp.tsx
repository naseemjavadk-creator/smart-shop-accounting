"use client";
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** "Install app" tile: one tap on Android/Chrome; on iPhone shows the Share → Add to Home Screen steps. Hidden once installed. */
export function InstallApp({ className }: { className?: string }) {
  const [evt, setEvt] = useState<BIP | null>(null);
  const [installed, setInstalled] = useState(true);
  const [ios, setIos] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BIP); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (installed) return null;
  async function install() {
    if (evt) { await evt.prompt(); await evt.userChoice; setEvt(null); } else setHelp(true);
  }
  return (
    <>
      <button onClick={install} className={className}>
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white"><Download size={26} /></span>
        <span>Install app<span className="mt-0.5 block text-[11px] font-normal text-slate-500">ആപ്പ് ആക്കാം</span></span>
      </button>
      {help && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setHelp(false)}>
          <div className="card w-full max-w-sm p-5 text-left text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between"><b className="text-base">Install on your phone</b><button onClick={() => setHelp(false)}><X size={18} /></button></div>
            {ios ? (
              <ol className="list-decimal space-y-1 pl-5">
                <li>Open this page in <b>Safari</b>.</li>
                <li>Tap the <b>Share</b> button (square with arrow ↑) at the bottom.</li>
                <li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
              </ol>
            ) : (
              <ol className="list-decimal space-y-1 pl-5">
                <li>Open this page in <b>Chrome</b>.</li>
                <li>Tap the <b>⋮</b> menu at the top right.</li>
                <li>Tap <b>Install app</b> (or <b>Add to Home screen</b>), then <b>Install</b>.</li>
              </ol>
            )}
            <p className="mt-2 text-slate-500">The app icon appears on your home screen and opens full screen.</p>
          </div>
        </div>
      )}
    </>
  );
}
