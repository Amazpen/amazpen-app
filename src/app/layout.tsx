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
        {/* Custom splash screen - shows immediately while app loads */}
        <div
          id="app-splash"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
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
              // Hide splash screen when app is ready
              (function() {
                function hideSplash() {
                  var splash = document.getElementById('app-splash');
                  if (splash) {
                    splash.style.opacity = '0';
                    splash.style.pointerEvents = 'none';
                    setTimeout(function() { splash.style.display = 'none'; }, 300);
                  }
                }
                // Hide after app hydrates or after max 3 seconds
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
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(function(reg) {
                    // Check for updates only when user returns to the tab
                    document.addEventListener('visibilitychange', function() {
                      if (document.visibilityState === 'visible') {
                        reg.update();
                      }
                    });
                  }).catch(function() {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
