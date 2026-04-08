import { authConfig } from "../config/auth.config.js";

export const isAllowedDomain = (email) => {
  if(!email)
    return false;
  return true;
  const domain = email.split("@")[1]?.toLowerCase();
  return domain
    ? authConfig.allowedEmailDomains.includes(domain)
    : false;
};