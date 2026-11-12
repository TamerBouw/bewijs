// Laat TypeScript weten dat `import tekst from '...?raw'` een string oplevert (Vite/Vitest-functie).
declare module '*?raw' {
  const inhoud: string;
  export default inhoud;
}
