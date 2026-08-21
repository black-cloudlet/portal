import type { Metadata } from "next";

import { branding } from "@/lib/config";

import "./globals.css";

export const metadata: Metadata = {
  // Pages set short titles ("Functions"); the template keeps the product name
  // in the tab so multiple console tabs stay tellable apart.
  title: {
    template: `%s · ${branding.productName}`,
    default: branding.productName,
  },
  description: `${branding.productName} - self-service console for the ${branding.organization} platform.`,
};

// Applies the persisted theme choice (see ThemeToggle) before first paint so a
// user who forced light/dark never sees a flash of the OS-default theme.
const themeInit = `try{var t=localStorage.getItem("portal-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
