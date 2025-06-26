import '@/app/globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'CodeVoyager' };

export default function RootLayout({ children }:{ children:ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full">
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // 전역 에러 핸들러: AbortError와 관련된 에러들을 무시
              window.addEventListener('error', function(event) {
                const error = event.error;
                if (error && (
                  error.name === 'AbortError' ||
                  (error.message && (
                    error.message.includes('aborted') ||
                    error.message.includes('BodyStreamBuffer was aborted') ||
                    error.message.includes('fetch was aborted')
                  ))
                )) {
                  console.log('Ignoring AbortError:', error.message);
                  event.preventDefault();
                  return false;
                }
              });
              
              // Promise rejection 핸들러
              window.addEventListener('unhandledrejection', function(event) {
                const reason = event.reason;
                if (reason && (
                  reason.name === 'AbortError' ||
                  (reason.message && (
                    reason.message.includes('aborted') ||
                    reason.message.includes('BodyStreamBuffer was aborted') ||
                    reason.message.includes('fetch was aborted')
                  ))
                )) {
                  console.log('Ignoring AbortError promise rejection:', reason.message);
                  event.preventDefault();
                }
              });
            `,
          }}
        />
        {children}
      </body>
    </html>
  );
}
