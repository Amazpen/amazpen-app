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
        url: "https://amazpen.supabase.brainboxai.io/storage/v1/object/public/amazpen//logo%20white.png",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "https://amazpen.supabase.brainboxai.io/storage/v1/object/public/amazpen//logo%20white.png",
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
  maximumScale: 1,
  userScalable: false,
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
            src="https://amazpen.supabase.brainboxai.io/storage/v1/object/public/amazpen//logo%20white.png"
            alt="Amazpen"
            width={400}
            height={189}
            unoptimized
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

                    var lastCheck = Date.now();
                    function checkForUpdate() {
                      var now = Date.now();
                      if (now - lastCheck < 30000) return;
                      lastCheck = now;
                      reg.update().catch(function() {});
                    }

                    document.addEventListener('visibilitychange', function() {
                      if (document.visibilityState === 'visible') { lastCheck = 0; checkForUpdate(); }
                    });

                    var origPush = history.pushState;
                    var origReplace = history.replaceState;
                    history.pushState = function() {
                      origPush.apply(this, arguments);
                      checkForUpdate();
                    };
                    history.replaceState = function() {
                      origReplace.apply(this, arguments);
                      checkForUpdate();
                    };
                    window.addEventListener('popstate', function() { checkForUpdate(); });

                    window.addEventListener('focus', function() { lastCheck = 0; checkForUpdate(); });
                  }).catch(function() {});
                });

                var refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', function() {
                  if (refreshing) return;
                  refreshing = true;
                  window.location.reload();
                });
              }
        `}</Script>
      </body>
    </html>
  );
}
