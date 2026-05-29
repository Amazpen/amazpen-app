import type { Metadata, Viewport } from "next";
import { Assistant, Poppins } from "next/font/google";
import Image from "next/image";
import Script from "next/script";
import "./globals.css";

const assistant = Assistant({
  variable: "--font-assistant",
  subsets: ["latin", "hebrew"],
  weight: ["200", "300", "400", "500", "600", "700", "800"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Amazpen | המצפן",
  description: "בשביל לנצח בעסקים חייבים להכיר את החוקים",
  manifest: "/manifest.json",
  icons: {
    icon: [
      {
        url: "/favicon.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  openGraph: {
    title: "Amazpen | המצפן",
    description: "בשביל לנצח בעסקים חייבים להכיר את החוקים",
    siteName: "app.amazpenbiz.co.il",
    type: "website",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "המצפן",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#6366f1",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className="dark" suppressHydrationWarning>
      <body className={`${assistant.variable} ${poppins.variable} font-sans antialiased`} suppressHydrationWarning>
        {/* Custom splash screen - hidden by default, shown only in standalone PWA mode */}
        <div
          id="app-splash"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0a0a0a',
            transition: 'opacity 0.3s ease-out',
          }}
        >
          <Image
            src="https://db.amazpenbiz.co.il/storage/v1/object/public/assets/logo/amazpen-logo.jpeg"
            alt="Amazpen"
            width={400}
            height={189}
            unoptimized
            priority
            loading="eager"
            style={{
              width: '70vw',
              maxWidth: '400px',
              height: 'auto',
              objectFit: 'contain',
            }}
          />
        </div>
        {children}
        <Script
          id="auto-cache-buster"
          strategy="afterInteractive"
        >{`
              (function() {
                // Detect a new build by reading sw.js BUILD_TIME, which is always
                // served fresh (no-cache header) and is regenerated on every deploy.
                // The previous approach embedded Date.now() at SSR time, but when the
                // HTML itself came from a stale cache that value never changed, so the
                // buster never fired and clients stayed stuck on old code.
                var KEY = "amazpen_build_version";
                function nukeAndReload() {
                  var done = function() { window.location.reload(); };
                  var unreg = function() {
                    if ('serviceWorker' in navigator) {
                      navigator.serviceWorker.getRegistrations().then(function(regs) {
                        return Promise.all(regs.map(function(r) { return r.unregister(); }));
                      }).then(done, done);
                    } else { done(); }
                  };
                  if ('caches' in window) {
                    caches.keys().then(function(keys) {
                      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
                    }).then(unreg, unreg);
                  } else { unreg(); }
                }
                try {
                  fetch('/sw.js?_cb=' + Date.now(), { cache: 'no-store' })
                    .then(function(r) { return r.text(); })
                    .then(function(text) {
                      var m = text.match(/BUILD_TIME=(\\d+)/);
                      if (!m) return;
                      var serverBuild = m[1];
                      var stored = localStorage.getItem(KEY);
                      if (!stored) { localStorage.setItem(KEY, serverBuild); return; }
                      if (stored !== serverBuild) {
                        localStorage.setItem(KEY, serverBuild);
                        // New build: wipe stale caches so new code loads.
                        // NOTE: onboarding tours (amazpen:completedTours) are
                        // intentionally preserved across deploys — users who
                        // dismissed the tour shouldn't see it again on every push.
                        nukeAndReload();
                      }
                    })
                    .catch(function() {});
                } catch (e) {}
              })();
        `}</Script>
        <Script
          id="pwa-install-capture"
          strategy="beforeInteractive"
        >{`
              window.__pwaInstallPrompt = null;
              window.addEventListener('beforeinstallprompt', function(e) {
                window.__pwaInstallPrompt = e;
                window.dispatchEvent(new Event('pwaInstallReady'));
              });
        `}</Script>
        <Script
          id="pwa-splash"
          strategy="beforeInteractive"
        >{`
              (function() {
                var isStandalone = window.matchMedia('(display-mode: standalone)').matches
                  || window.navigator.standalone === true;
                if (!isStandalone) return;

                var splash = document.getElementById('app-splash');
                if (!splash) return;
                splash.style.display = 'flex';

                function hideSplash() {
                  if (splash) {
                    splash.style.opacity = '0';
                    splash.style.pointerEvents = 'none';
                    setTimeout(function() { splash.style.display = 'none'; }, 300);
                  }
                }
                if (document.readyState === 'complete') {
                  setTimeout(hideSplash, 500);
                } else {
                  window.addEventListener('load', function() {
                    setTimeout(hideSplash, 500);
                  });
                }
                setTimeout(hideSplash, 3000);
              })();
        `}</Script>
        <Script
          id="sw-registration"
          strategy="afterInteractive"
        >{`
              if ('serviceWorker' in navigator) {
                window.__SW_UPDATE_CALLBACKS = [];
                window.__SW_WAITING = null;

                function notifySwUpdate(worker) {
                  window.__SW_WAITING = worker;
                  window.__SW_UPDATE_CALLBACKS.forEach(function(cb) { cb(worker); });
                }

                function trackUpdate(reg) {
                  if (reg.waiting) {
                    notifySwUpdate(reg.waiting);
                  }
                  reg.addEventListener('updatefound', function() {
                    var newWorker = reg.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', function() {
                      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        notifySwUpdate(newWorker);
                      }
                    });
                  });
                }

                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(function(reg) {
                    trackUpdate(reg);

                    // Immediately check for updates on page load
                    reg.update().catch(function() {});

                    // Check for SW updates every 60s (lightweight - just compares sw.js hash)
                    setInterval(function() { reg.update().catch(function() {}); }, 60000);

                    document.addEventListener('visibilitychange', function() {
                      if (document.visibilityState === 'visible') reg.update().catch(function() {});
                    });

                    window.addEventListener('focus', function() { reg.update().catch(function() {}); });
                  }).catch(function() {});
                });

                // A new SW took control (we now skipWaiting() automatically on
                // deploy). Reload so the client runs the fresh build. To avoid
                // yanking the page out from under someone mid-task, only reload
                // immediately when the tab is hidden; otherwise reload on the
                // next time the tab regains focus / becomes visible.
                var refreshing = false;
                function doRefresh() {
                  if (refreshing) return;
                  refreshing = true;
                  window.location.reload();
                }
                navigator.serviceWorker.addEventListener('controllerchange', function() {
                  if (document.visibilityState === 'hidden') {
                    doRefresh();
                  } else {
                    var onVisible = function() {
                      if (document.visibilityState === 'visible') {
                        document.removeEventListener('visibilitychange', onVisible);
                        doRefresh();
                      }
                    };
                    // Reload as soon as the user leaves and comes back, or on
                    // next focus — whichever happens first. Falls back to a
                    // short delay so an always-foreground PWA still updates.
                    document.addEventListener('visibilitychange', onVisible);
                    window.addEventListener('focus', doRefresh, { once: true });
                    setTimeout(doRefresh, 3000);
                  }
                });
              }
        `}</Script>
      </body>
    </html>
  );
}
