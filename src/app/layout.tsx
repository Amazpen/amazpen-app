import type { Metadata, Viewport } from "next";
import { Assistant, Poppins } from "next/font/google";
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
    siteName: "amazpenbiz.co.il",
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
          <img
            src="https://amazpen.supabase.brainboxai.io/storage/v1/object/public/amazpen//logo%20white.png"
            alt="Amazpen"
            style={{
              width: '70vw',
              maxWidth: '400px',
              height: 'auto',
              objectFit: 'contain',
            }}
          />
        </div>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Show splash only when opened as installed PWA (standalone mode)
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
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
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

                    // Throttled update check - max once per 30 seconds
                    var lastCheck = 0;
                    function checkForUpdate() {
                      var now = Date.now();
                      if (now - lastCheck < 30000) return;
                      lastCheck = now;
                      reg.update();
                    }

                    // Check when user returns to tab
                    document.addEventListener('visibilitychange', function() {
                      if (document.visibilityState === 'visible') checkForUpdate();
                    });

                    // Check on SPA navigation (Next.js uses pushState/replaceState)
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

                    // Also check on every fetch response (detects deploy via changed HTML)
                    window.addEventListener('focus', function() { checkForUpdate(); });
                  }).catch(function() {});
                });

                // Reload when new SW takes over
                var refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', function() {
                  if (refreshing) return;
                  refreshing = true;
                  window.location.reload();
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
