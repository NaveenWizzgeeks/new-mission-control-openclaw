import type { Metadata } from 'next';
import './globals.css';
import localFont from 'next/font/local';
import DemoBanner from '@/components/DemoBanner';
import { ToastProvider } from '@/components/Toast';
import { ChatProvider } from '@/components/chat/ChatProvider';
import { ConfirmProvider } from '@/components/ConfirmDialog';

// Self-host JetBrains Mono so dev/prod don't depend on fonts.googleapis.com.
// The previous next/font/google setup spammed warnings and rendered the
// fallback whenever the dev box was offline. The woff2 below is the latin
// subset; weights 500/600/700 are synthesized by the browser, which is fine
// for monospace UI chrome.
const jetbrainsMono = localFont({
  src: '../../public/fonts/JetBrainsMono-Latin.woff2',
  variable: '--font-jetbrains-mono',
  display: 'swap',
  weight: '400 700',
});

export const metadata: Metadata = {
  title: 'Mission Control',
  description: 'AI Agent Orchestration Dashboard',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={jetbrainsMono.variable}>
      <head>
        {/* No-flash theme bootstrap. Reads `mc-theme` from localStorage and
            applies the class on <html> BEFORE React hydrates, so the page
            doesn't flash the wrong theme on first paint. Defaults to dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var t = localStorage.getItem('mc-theme');
                  if (t === 'light') document.documentElement.classList.add('theme-light');
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className={`${jetbrainsMono.className} bg-mc-bg text-mc-text h-screen overflow-hidden flex flex-col`}>
        <ToastProvider>
          <ConfirmProvider>
            <DemoBanner />
            <ChatProvider>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {children}
              </div>
            </ChatProvider>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
