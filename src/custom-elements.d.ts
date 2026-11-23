import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type A2uiSurfaceElement = HTMLElement & {
  surface?: unknown;
};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'maui-providers': DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          'additional-attribution-ids'?: string;
        },
        HTMLElement
      >;
      'a2ui-surface': DetailedHTMLProps<
        HTMLAttributes<A2uiSurfaceElement>,
        A2uiSurfaceElement
      >;
    }
  }
}

export {};
