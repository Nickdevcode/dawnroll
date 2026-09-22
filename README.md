# 🪲 Rola Bosta

Um besouro rola-bosta de massinha num jardim em miniatura. Sem história, sem objetivo imposto: é só você, o besouro bonitão e uma bola de bosta que cresce enquanto você rola ela por aí. 💩➡️🟤

> Visual inspirado em **Human Fall Flat**: tudo com cara de massinha (fosco, aveludado, com marquinha de dedo), luz suave e oclusão ambiente forte.

---

## 🎮 Como jogar

| Ação | Teclado / mouse | Celular |
|---|---|---|
| Andar | `W` `A` `S` `D` (ou setas) | Analógico à esquerda |
| Olhar em volta | Mouse | Arrastar na metade direita |
| **Agarrar / empurrar a bola** | **Segurar `E`** ou o botão esquerdo | Botão da mão (liga/desliga) |
| Pular | `Espaço` | Botão de seta |
| Correr | `Shift` | Botão de correr |
| Trazer a bola de volta | `R` | — |
| Zoom | Roda do mouse | — |
| Pausar | `Esc` | — |

### 🟤 A mecânica
- **Empurrar:** chega perto da bola e segura `E`. O besouro vira de costas, apoia a cabeça no chão e empurra com as patas traseiras, de ré, igualzinho ao rola-bosta de verdade. Você só aponta a direção.
- **Crescer:** passe a bola por cima dos **montinhos de bosta** espalhados. Ela absorve e cresce.
- **Grudar coisas (estilo Katamari):** quando a bola fica grande o bastante, pedrinhas, gravetos, folhas e frutinhas grudam nela. Conforme a bola cresce, os mais antigos ficam soterrados.
- **Peso de verdade:** bola maior = mais pesada, mais lenta pra acelerar, mais difícil de virar e de subir ladeira.

---

## 🚀 Rodando no seu PC

Precisa do **Node.js 20+** instalado.

```bash
npm install      # só na primeira vez
npm run dev      # abre em http://localhost:5173
```

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm run build` | Checa os tipos e gera a versão final em `dist/` |
| `npm run preview` | Serve a pasta `dist/` pra testar a versão final |
| `npm run typecheck` | Só checa os tipos do TypeScript |

---

## 🧱 Tecnologias

| Peça | Pra quê |
|---|---|
| [Three.js](https://threejs.org) r186 | Renderização 3D (WebGL 2) |
| [Rapier](https://rapier.rs) 0.20 (WASM) | Física: bola rolando, colisões, controlador do besouro |
| [Vite](https://vite.dev) 8 + TypeScript | Build e servidor de desenvolvimento |

Não tem nenhum arquivo de modelo, textura ou som: **tudo é gerado por código** (modelos procedurais, normal map de massinha, sons sintetizados com Web Audio).

---

## 🗂️ Estrutura

```
src/
├── main.ts                 # entrada: checa WebGL 2 e sobe o jogo
├── Game.ts                 # laço de jogo, pausa, dicas, qualidade adaptativa
├── core/
│   ├── Physics.ts          # mundo Rapier, passo fixo 60 Hz, grupos de colisão
│   ├── Input.ts            # teclado + mouse (pointer lock) + toque
│   └── ThirdPersonCamera.ts
├── render/
│   ├── Graphics.ts         # renderer, luzes, céu, pós-processamento (GTAO + vinheta)
│   ├── clayMaterial.ts     # fábrica do material de massinha (com cache)
│   └── geometry.ts         # "amassa" primitivas com ruído
├── entities/
│   ├── BeetleModel.ts      # o besouro bonitão + animação procedural das 6 patas
│   ├── Beetle.ts           # controle: andar, pular, agarrar e empurrar
│   └── DungBall.ts         # a bola: física, crescimento, itens grudados, squash
├── world/
│   ├── Terrain.ts          # relevo (fonte única de altura) + colisor
│   ├── Scenery.ts          # pedras, cogumelos, flores, gravetos, árvores gigantes, nuvens
│   ├── Grass.ts            # grama instanciada com vento e que abre caminho
│   └── Collectibles.ts     # montinhos de bosta e detritos grudáveis
├── audio/Sfx.ts            # efeitos sintetizados
└── ui/                     # HUD, tela inicial, controles de toque, design tokens
```

---

## 🛠️ Decisões e pegadinhas

- **Física em passo fixo (60 Hz) + render interpolado:** o jogo se comporta igual em monitor de 60 ou 144 Hz.
- **Besouro cinemático, bola dinâmica:** o solver *não* gera força entre os dois (senão o besouro empurraria com massa infinita). Toda força na bola passa pela lógica de empurrar, que tem limite e fica mais fraca conforme a bola cresce.
- **Bola crescendo por cima do besouro:** o controlador de personagem do Rapier não sai de dentro de um colisor sozinho, então existe uma "des-penetração" manual.
- **Contato perto do chão:** a distância do besouro até a bola é calculada na altura do traseiro dele, não no equador da bola (senão sobrava um vão enorme com bola grande).
- **Resistência ao rolamento:** o Rapier não tem, então a bola é freada à mão (mais forte quando está devagar, pra não sair rolando sozinha).
- **Qualidade adaptativa:** se o aparelho não segurar ~40 fps nos primeiros segundos, o jogo desliga a oclusão ambiente e reduz a resolução.
- **Escala:** 1 unidade ≈ 2 cm. O HUD mostra o diâmetro da bola em centímetros.
