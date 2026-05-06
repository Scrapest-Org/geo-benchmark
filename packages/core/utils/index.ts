function randomJitter(base: number, spread: number) {
  const delta = Math.floor(Math.random() * (spread * 2 + 1)) - spread;
  return base + delta;
}

export { randomJitter };
export { alert } from "./alert";
