import type { Preview } from '@storybook/nextjs-vite'
import { mswLoader } from 'msw-storybook-addon/csf3';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { ToastProvider } from '../src/components/ui/toast';
import { UnsavedChangesProvider } from '../src/components/ui/unsaved-changes';
import { t, type Locale } from '../src/i18n/messages';
import '../src/app/globals.css';
import { mswHandlers } from './msw-handlers';

const font = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-plus-jakarta-sans' });

const preview: Preview = {
  initialGlobals: { theme: 'light', locale: 'en' },
  globalTypes: {
    theme: { toolbar: { icon: 'circlehollow', items: ['light', 'dark'] } },
    locale: { toolbar: { icon: 'globe', items: ['en', 'id'] } },
  },
  decorators: [
    (Story, context) => {
      const locale: Locale = context.globals.locale === 'id' ? 'id' : 'en';
      const theme = context.globals.theme === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      document.documentElement.lang = locale;
      document.documentElement.style.colorScheme = theme;
      document.documentElement.classList.add(font.variable);
      return (
        <ToastProvider notificationsLabel={t(locale, 'common.notifications')}>
          <UnsavedChangesProvider locale={locale}>
            <Story />
          </UnsavedChangesProvider>
        </ToastProvider>
      );
    },
  ],
  loaders: [mswLoader()],
  async beforeEach({ msw }) {
    msw.use(...mswHandlers);
  },
  parameters: {
    nextjs: { appDirectory: true },
    a11y: { test: 'error' },
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
  },
};

export default preview;
