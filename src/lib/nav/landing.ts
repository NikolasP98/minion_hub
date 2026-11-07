/**
 * The ONE place that decides where `/` lands (spec 046 FR-007). Pure: the server
 * (`$server/nav/landing.server`) builds the inputs; the hook and the (app)
 * layout both call it, so the redirect and the sidebar's home mark agree.
 */

/**
 * Root-relative, same-origin path: not protocol-relative (`//evil.com`) nor
 * backslash-tricked (`/\evil.com`). `~` admits custom-section instance paths.
 */
export const SAFE_PATH = /^\/(?![/\\])[A-Za-z0-9/_\-?=&.~]*$/;

/** The last resort, and the only literal landing path in the app. */
export const CHAT_PATH = '/chat';

/** Where the chat screen lived before spec 046; now a 308 to `CHAT_PATH`. */
export const LEGACY_HOME_PATH = '/home';

export interface LandingInput {
  userChoice: unknown;
  orgChoice: unknown;
  canView: (path: string) => boolean;
  mode: 'full' | 'module';
  /** Hrefs of the organization section, in nav order. */
  orgItems: readonly string[];
  /** Every other module's href (and its pages), in nav order. */
  moduleHrefs: readonly string[];
}

const usable = (choice: unknown, canView: (p: string) => boolean): choice is string =>
  typeof choice === 'string' && SAFE_PATH.test(choice) && canView(choice);

/** User choice → org choice → first viewable nav item for the mode → `/chat`. */
export function effectiveLandingPage(input: LandingInput): string {
  const { userChoice, orgChoice, canView, mode, orgItems, moduleHrefs } = input;
  if (usable(userChoice, canView)) return userChoice;
  if (usable(orgChoice, canView)) return orgChoice;
  const order = mode === 'full' ? [...orgItems, ...moduleHrefs] : [...moduleHrefs, ...orgItems];
  return order.find((p) => usable(p, canView)) ?? CHAT_PATH;
}
