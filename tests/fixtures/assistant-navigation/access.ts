let permitted = true;
export const canViewPath = () => permitted;
export function revoke() {
  permitted = false;
}
export const canAct = () => false;
export const canClient = () => false;
