import { TranslationKeys, useLocalize } from '~/hooks';
import { BlinkAnimation } from './BlinkAnimation';
import { TStartupConfig } from 'librechat-data-provider';
import SocialLoginRender from './SocialLoginRender';
import { ThemeSelector } from '~/components/ui';
import { Banner } from '../Banners';
import Footer from './Footer';

const ErrorRender = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-16 flex justify-center">
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-md border border-red-500 bg-red-500/10 px-3 py-2 text-sm text-gray-600 dark:text-gray-200"
    >
      {children}
    </div>
  </div>
);

function AuthLayout({
  children,
  header,
  isFetching,
  startupConfig,
  startupConfigError,
  pathname,
  error,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  isFetching: boolean;
  startupConfig: TStartupConfig | null | undefined;
  startupConfigError: unknown | null | undefined;
  pathname: string;
  error: TranslationKeys | null;
}) {
  const localize = useLocalize();

  const hasStartupConfigError = startupConfigError !== null && startupConfigError !== undefined;
  const DisplayError = () => {
    if (hasStartupConfigError) {
      return <ErrorRender>{localize('com_auth_error_login_server')}</ErrorRender>;
    } else if (error === 'com_auth_error_invalid_reset_token') {
      return (
        <ErrorRender>
          {localize('com_auth_error_invalid_reset_token')}{' '}
          <a className="font-semibold text-green-600 hover:underline" href="/forgot-password">
            {localize('com_auth_click_here')}
          </a>{' '}
          {localize('com_auth_to_try_again')}
        </ErrorRender>
      );
    } else if (error != null && error) {
      return <ErrorRender>{localize(error)}</ErrorRender>;
    }
    return null;
  };

  return (
    <div
      style={{
        backgroundImage: 'url("/assets/hospital.jpg")',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
      className="relative flex min-h-screen flex-col bg-white dark:bg-gray-900 before:content-[''] before:absolute before:inset-0 before:bg-black/40 dark:before:bg-black/50"
    >
      <Banner />
      <DisplayError />
      <div className="absolute bottom-0 left-0 md:m-4 z-10">
        <ThemeSelector />
      </div>

      <div className="flex flex-grow items-center justify-center relative z-10">
        <div className="w-authPageWidth overflow-hidden bg-white/90 dark:bg-gray-900/90 backdrop-blur-md px-6 py-4 sm:max-w-md sm:rounded-lg shadow-xl">
          <div className="flex justify-center mb-6">
            <div className="rounded-xl overflow-hidden bg-white/80 backdrop-blur-sm p-2 shadow-lg">
              <img
                src="/assets/hospital-logo.png"
                className="h-16 w-auto object-contain"
                alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'LibreChat' })}
              />
            </div>
          </div>
          {!hasStartupConfigError && !isFetching && (
            <h1
              className="mb-4 text-center text-3xl font-semibold text-black dark:text-white"
              style={{ userSelect: 'none' }}
            >
              {header}
            </h1>
          )}
          {children}
          {!pathname.includes('2fa') &&
            (pathname.includes('login') || pathname.includes('register')) && (
            <SocialLoginRender startupConfig={startupConfig} />
          )}
        </div>
      </div>
      <Footer startupConfig={startupConfig} />
    </div>
  );
}

export default AuthLayout;
