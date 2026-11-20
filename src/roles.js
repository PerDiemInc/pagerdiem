export const ROLES = ['admin', 'engineer', 'non_technical'];

export const ROLE_LABELS = { admin: 'Admin', engineer: 'Engineer', non_technical: 'Non-technical' };

export const DEFAULT_ROLE = 'non_technical';

export const isRole = (value) => ROLES.includes(value);

export const isAdmin = (user) => user?.role === 'admin';

/** Engineers and admins can be on call and can acknowledge or resolve incidents. */
export const isResponder = (user) => user?.role === 'admin' || user?.role === 'engineer';
