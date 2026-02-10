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
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').then(function(reg) {
                    // Check for updates every 60 seconds
                    setInterval(function() { reg.update(); }, 60000);
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
