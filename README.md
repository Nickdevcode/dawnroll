# 🪲 Rola Bosta

Um besouro rola-bosta de massinha num jardim em miniatura. Você rola uma bola de bosta, ela cresce, **engole o jardim** (flor, cogumelo, pedra, tronco...) e no fim você **enterra ela na toca** pra marcar recorde. Aí o jardim se refaz e começa tudo de novo, com bola pequena. 💩➡️🟤➡️🕳️

### ▶️ Jogar agora: **[rola-bosta.vercel.app](https://rola-bosta.vercel.app)** (PC ou celular)

> Visual inspirado em **Human Fall Flat**: tudo com cara de massinha (fosco, aveludado, com marquinha de dedo e até digital), luz suave, oclusão ambiente forte e um desfoque de **maquete** que faz o jardim parecer um diorama fotografado de pertinho.

### ✨ O que tem no jardim

| | |
|---|---|
| 🌱 **Vegetação densa** | ~17 mil tufos de grama (que brilham contra o sol e abrem caminho pro besouro), trevos, florzinhas rasteiras e folhas secas caídas |
| 🌼 **Flores gigantes** | Margaridas, tulipas, campânulas, dentes-de-leão e flores de trevo, todas balançando com o vento |
| 🍄 **Cogumelos** | Em touceiras, com pé de bulbo, saia, lamelas esculpidas e bolinhas no chapéu |
| 🪨 **Pedras e troncos** | Rochedos com musgo e líquen, troncos com anéis na ponta e orelha-de-pau |
| 🦋 **Bichinhos** | Borboletas (9 paletas), abelhas com cestinha de pólen, libélulas de 4 asas, joaninhas que abrem os élitros e voam, caracóis que recolhem os olhos, **formigas em trilha** saindo dos formigueiros (algumas carregando folhinha), **tatuzinhos** que viram bolinha (e grudam na bola!), **gafanhotos** que pulam, **minhocas** que saem na chuva e **sapos** na beira das poças cheias |
| 🕳️ **A toca** | Buraco de terra fofa com bandeirinha de folha no monte escavado. Um anel tracejado pulsa quando a bola já pode ser enterrada |
| 🌧️ **Clima** | Sol → nublando → chuva (com rajadas, relâmpago e trovão) → abrindo. O céu fecha, a luz fica difusa, tudo fica molhado e brilhante |
| 💧 **Poças** | Seis bacias rasas (uma de lama no meio da trilha) que enchem na chuva, com anéis de gota, reflexo do céu e borda rasa transparente. Secam devagar |
| 💨 **Efeitos** | Poeira nos passos e na bola, respingo ao pegar bosta, brilho ao grudar, confete nos marcos, rastro da bola no chão, fedor subindo dos montinhos, suor quando o besouro faz força, torrões e pétalas ao arrancar coisas, terra voando no enterro, respingos d'água, folhas caindo e pólen no ar |

---

## 🎮 Como jogar

| Ação | Teclado / mouse | Celular |
|---|---|---|
| Andar | `W` `A` `S` `D` (ou setas) | Analógico à esquerda |
| Olhar em volta | Mouse | Arrastar na metade direita |
| **Agarrar / empurrar a bola** | **Segurar `E`** ou o botão esquerdo | Botão da mão (liga/desliga) |
| Pular | `Espaço` | Botão de seta |
| Correr | `Shift` | Botão de correr |
| Trazer a bola de volta | `R` | Botão circular no topo |
| Zoom | Roda do mouse | — |
| Pausar | `Esc` | — |

### 🟤 A mecânica
- **Empurrar:** chega perto da bola e segura `E`. O besouro vira de costas, apoia a cabeça no chão e empurra com as patas traseiras, de ré, igualzinho ao rola-bosta de verdade. Você só aponta a direção.
- **Crescer:** passe a bola por cima dos **montinhos de bosta** espalhados. Ela absorve e cresce.
- **Grudar coisas (estilo Katamari):** quando a bola fica grande o bastante, pedrinhas, gravetos, folhas e frutinhas grudam nela. Conforme a bola cresce, os mais antigos ficam soterrados.
- **Engolir o jardim:** maior ainda, a bola **arranca do chão** cogumelos, flores, pedras e troncos, que voam e grudam nela (e engordam bem mais que bosta). O que ainda é grande demais só faz a bola bater, e o jogo avisa quantos cm faltam.
- **Enterrar na toca:** a partir de **3 cm**, siga a bandeirinha (um marcador no HUD aponta pra ela) e empurre a bola pra dentro da boca da toca. A bola afunda girando, a terra voa e aparece o placar. Recorde e bolas enterradas ficam salvos no navegador.
- **Rodada nova:** depois do enterro o jardim volta inteiro, os montinhos renascem e uma bola pequena brota do lado do besouro.
- **Chuva e poças:** a água das poças **derrete a bola** (bola pequena derrete rápido; gigante quase nada) e freia; o besouro anda mais devagar com água na canela. Em compensação, rolar na **terra molhada** gruda lama na bola: engorda um pouco, mas pesa.
- **Peso de verdade:** bola maior = mais pesada, mais lenta pra acelerar, mais difícil de virar e de subir ladeira (a partir de ~12 cm a velocidade estabiliza, pra bola gigante não virar lesma).

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

> 🧪 No `npm run dev`, a tecla **F8** adianta o clima pra próxima fase (sol → nublando → chuva → abrindo). Não existe na versão publicada.

---

## ☁️ Deploy

| Onde | Link |
|---|---|
| 🐙 Código | [github.com/Nickdevcode/rola-bosta](https://github.com/Nickdevcode/rola-bosta) |
| ▲ Produção | [rola-bosta.vercel.app](https://rola-bosta.vercel.app) |

A Vercel tá ligada ao repo: **todo `git push` na `main` publica sozinho** em produção. Pull requests e outras branches ganham um link de preview próprio.

---

## 📱 Celular

- Aparece um analógico (andar), uma área de arrastar pra olhar e botões de correr, agarrar e pular.
- A câmera volta sozinha pra trás do besouro quando você para de mexer nela.
- Perfil gráfico mais leve: sem oclusão ambiente, sem desfoque de maquete e sem bloom, menos pixels, sombra menor, menos grama, menos enfeites e menos bichinhos. Se ainda assim ficar abaixo de ~40 fps, o jogo reduz mais (e mais um degrau se cair abaixo de ~30).
- Pausa sozinho se você sair do app ou trocar de aba.

---

## 🧱 Tecnologias

| Peça | Pra quê |
|---|---|
| [Three.js](https://threejs.org) r186 | Renderização 3D (WebGL 2) |
| [Rapier](https://rapier.rs) 0.20 (WASM) | Física: bola rolando, colisões, controlador do besouro |
| [Vite](https://vite.dev) 8 + TypeScript | Build e servidor de desenvolvimento |

Não tem nenhum arquivo de modelo, textura ou som: **tudo é gerado por código** (modelos procedurais, normal map de massinha, céu pintado em canvas, partículas, sons sintetizados com Web Audio).

---

## 🗂️ Estrutura

```
src/
├── main.ts                 # entrada: checa WebGL 2 e sobe o jogo
├── Game.ts                 # laço de jogo, rodadas, clima, água/lama, dicas, qualidade adaptativa
├── core/
│   ├── Physics.ts          # mundo Rapier, passo fixo 60 Hz, grupos de colisão
│   ├── Input.ts            # teclado + mouse (pointer lock) + toque
│   ├── device.ts           # perfis de qualidade (PC x celular)
│   ├── save.ts             # recorde e bolas enterradas no localStorage (validado)
│   └── ThirdPersonCamera.ts # órbita, colisão com o cenário e tremidinha de impacto
├── render/
│   ├── Graphics.ts         # renderer, cúpula do céu (sol x chuva), luzes, pós (GTAO, DOF, bloom, grading)
│   ├── clayMaterial.ts     # material de massinha (digitais, mosqueado, manchas úmidas, vento, chuva)
│   ├── shaderChunks.ts     # GLSL e uniforms globais (ruído, vento, grama que deita, molhado)
│   ├── StaticBatch.ts      # funde milhares de peças em poucos draw calls (e apaga as arrancadas)
│   ├── ChunkedInstances.ts # instâncias em pedaços do mapa com LOD por distância
│   ├── InstancePool.ts     # vagas de instância (detritos, montinhos, moscas)
│   ├── mergeStatic.ts      # funde enfeites presos na mesma junta (besouro)
│   └── geometry.ts         # "amassa" primitivas, pinta vértices, tubos afinando
├── entities/
│   ├── BeetleModel.ts      # o besouro bonitão + animação procedural das 6 patas
│   ├── Beetle.ts           # controle: andar, pular, agarrar e empurrar
│   └── DungBall.ts         # a bola: física, crescimento, itens grudados (com voo), derreter, enterro
├── world/
│   ├── Terrain.ts          # relevo (fonte única de altura, com toca e poças esculpidas) + colisor
│   ├── sites.ts            # onde ficam a toca e as bacias das poças (determinístico)
│   ├── Scenery.ts          # decide onde as coisas vão, monta o lote e registra os arrancáveis
│   ├── scenery/            # um construtor por tipo: pedras, cogumelos, flores, troncos,
│   │                       # árvores gigantes, fundo (moitas, vaso), nuvens, formas base
│   ├── Pickables.ts        # Katamari do cenário: arrancar, grudar e "falta crescer X cm"
│   ├── Burrow.ts           # a toca: bandeirinha, anel, enterro da bola
│   ├── Weather.ts          # ciclo do tempo (nublado, chuva, relâmpago, molhado, poças enchendo)
│   ├── Puddles.ts          # água das poças (shader com profundidade e anéis de gota)
│   ├── Grass.ts            # grama instanciada com vento, translucidez e LOD
│   ├── GroundCover.ts      # trevos, florzinhas e folhas secas
│   └── Collectibles.ts     # montinhos (espiral), moscas e 10 tipos de detrito grudável
├── fx/
│   ├── Effects.ts          # central de efeitos (eventos do jogo -> partículas)
│   ├── SoftParticles.ts    # poeira/fedor/brilho (pool num THREE.Points só)
│   ├── ChunkParticles.ts   # pedacinhos com física (respingo, torrão, confete, folha)
│   ├── BallTrail.ts        # rastro da bola no chão
│   ├── AmbientMotes.ts     # pólen flutuando (100% no shader)
│   ├── Rain.ts             # riscos de chuva (100% no shader) + anéis de respingo
│   └── critters/           # fauna instanciada por espécie: voadores, rasteiros, formigas,
│                           # tatuzinho, gafanhoto, minhoca, sapo (reage à chuva e às poças)
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
- **Muita coisa, poucos draw calls:** o cenário estático é assado num lote (uma malha por acabamento × pedaço do mapa, cor nos vértices); grama e cobertura do chão são instâncias em pedaços; detritos parados, montinhos e moscas são vagas num `InstancedMesh`. Um detrito só vira `Mesh` de verdade quando gruda na bola.
- **LOD sem buraco:** as instâncias de cada pedaço são embaralhadas, então desenhar só os primeiros N (longe da câmera) deixa o gramado mais ralo por igual, sem clarões.
- **Grama fora do AO:** o passe de oclusão desenha a cena com um material próprio, que não roda o vento da grama — então a vegetação animada é escondida só durante esse passe (senão aparecem "sombras fantasmas" da grama parada).
- **AO em meia resolução:** era o passe mais caro do jogo; na massinha a oclusão já é macia, então metade da resolução fica igual e custa bem menos. O desfoque de maquete reaproveita a profundidade que o AO já renderiza.
- **Pólen sem CPU:** cada ponto tem uma semente fixa e o shader calcula a deriva e "dá a volta" numa caixa em torno da câmera.
- **Câmera x cenário:** um raio da física do foco até a câmera encurta a distância quando tem pedra ou cogumelo no meio (entra rápido, volta devagar).
- **Arrancar sem perder o lote:** flores, cogumelos, pedras e troncos continuam fundidos no lote estático. O lote guarda em que trecho do índice cada um caiu; "arrancar" troca esses triângulos por triângulos degenerados. Vale pra todo passe (cor, sombra, AO, profundidade) sem shader especial, e o draw call continua um só. Na rodada nova, os índices originais voltam. O colisor só é desligado (`setEnabled(false)`), não destruído.
- **Encostou = contato de verdade:** pra decidir que a bola tocou num arrancável, vale o contato real do Rapier com o colisor dele (pedra tem casco irregular) ou, pros que não têm colisor, uma cápsula de proximidade.
- **Item voando até a bola:** ao grudar, o item sai da posição dele no mundo e é animado (posição, rotação e escala) até assentar na bola, já no espaço dela, então ele gira junto enquanto voa.
- **Toca e poças esculpidas no relevo:** elas entram na própria função de altura, então malha, colisor, grama e bichos enxergam o mesmo buraco. A borda de cada bacia fica no ponto mais baixo em volta (senão poça em ladeira vira platô).
- **Margem da poça de graça:** a água é um disco plano no nível atual; o terreno esconde o que fica "embaixo do chão", então a margem se desenha sozinha e a poça cresce de verdade quando enche. A transparência da borda vem da profundidade, calculada no shader com a mesma fórmula da bacia.
- **Céu com clima:** o fundo virou uma cúpula colada na câmera que mistura dois céus pintados em canvas (sol e chuva). Fica fora do AO e não escreve profundidade.
- **Molhado em tudo com um uniform só:** `uWetness` é compartilhado por massinha, chão e grama: escurece e tira aspereza em manchas (nunca 100% espelhado, senão vira plástico).
- **Muito bicho, poucos draw calls:** cada parte de cada espécie (corpo, asa, pata...) é um `InstancedMesh` com as matrizes calculadas na CPU; parte sem ninguém visível desliga sozinha. São ~26 draw calls de fauna no seco e ~31 na chuva, com ~0,2 ms de CPU por frame.
- **Pouso que some:** os pontos de pouso dos insetos formam um array vivo; quando a bola arranca a flor, o ponto sai da lista e a borboleta que estava ali levanta voo.
- **Recorde à prova de lixo:** o save é lido com validação (número finito, não negativo, com teto); aba anônima ou storage bloqueado só não salva.
