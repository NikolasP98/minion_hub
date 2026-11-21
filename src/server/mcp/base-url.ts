import { hubBaseUrl } from '$server/config/urls';

/** The configured public hub URL without a trailing slash: issuer, resource and metadata URLs (spec 143 P12). */
export const publicBase = () => hubBaseUrl().replace(/\/+$/, '');
