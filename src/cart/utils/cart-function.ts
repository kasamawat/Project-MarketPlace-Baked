export function computeAvailable(onHand?: number, reserved?: number) {
  return Math.max(0, (onHand ?? 0) - (reserved ?? 0));
}
