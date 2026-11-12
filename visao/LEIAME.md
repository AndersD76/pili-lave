# Câmeras da loja (etapa 5)

Programa em Python que roda no computador central da loja, ao lado do
programa da loja (`loja/`, porta 3100). Ele olha as câmeras do teto e avisa a
loja quando:

- **algo saiu ou voltou de uma zona de prateleira** (evento `PRATELEIRA`,
  com as visitas que estiveram na frente da zona e as fotos antes/durante/depois);
- **alguém entrou sem visita aberta** (evento `PORTA`, liga a sirene);
- **uma câmera caiu, foi tapada ou saiu do lugar** (evento `CAMERA`).

Não decide nada sozinho: quem atribui a divergência e avisa o dono é a loja.

## Como rodar

1. `iniciar.bat` — na primeira vez cria o ambiente `.venv`, instala o que
   está em `requirements.txt` e baixa o detector de pessoas para `modelos/`
   (`baixar_modelos.py`). `iniciar.bat --mostrar` abre uma
   janela por câmera, com as zonas e as pessoas desenhadas.
2. Antes, marque as zonas de cada câmera:
   `.venv\Scripts\python desenhar_zonas.py --camera cam1 --fonte 0`
   (clique os cantos; `N` zona de prateleira, `P` porta, `R` quadro de
   referência, `V` foto da prateleira vazia, `S` salva — a lista de teclas
   está no começo do arquivo).
3. Testes: `.venv\Scripts\python -m pytest testes`

## config.json

- `cameras[].fonte`: número da webcam (`0`), arquivo de vídeo ou endereço
  RTSP. Intelbras: `rtsp://usuario:senha@IP:554/cam/realmonitor?channel=1&subtype=0`.
  Com a senha das câmeras dentro, o `config.json` da loja de verdade não deve
  ir para o Git.
- Zonas em coordenadas de 0 a 1 (valem para qualquer resolução).
  `areaItem` (opcional) = fração da zona que um item ocupa, para estimar
  quantos saíram; sem ela, cada mudança conta 1.
- `prateleira.detector`: `diferenca` (padrão) ou `sku` com `pesosSku`
  apontando para um YOLO treinado no SKU-110K (aí a contagem é de verdade).
- O token da loja vem de `loja/dados/token-local.txt` ou de `LOJA_TOKEN_LOCAL`.

## Como funciona, em resumo

- **Pessoas**: YOLOX oficial da Megvii em ONNX Runtime (licença Apache-2.0),
  mais uma associação de caixas no estilo do ByteTrack escrita aqui
  (`AssociadorCaixas`, sem filtro de Kalman), uma instância por câmera.
  `pessoas.pesos`: `modelos/yolox_tiny.onnx` (padrão, ~49 ms por quadro no
  notebook sem placa de vídeo) ou `modelos/yolox_s.onnx` (mais preciso, ~205 ms
  — para quando houver placa de vídeo). `pessoas.detector: "ultralytics"`
  volta ao YOLO antigo, só para comparar: ele é AGPL-3.0 e não deve ir para
  uma loja comercial sem a licença paga. Medir: `python medir_fps.py --comparar`.
- **Rastro ↔ visita**: quem aparece na zona da porta recebe a visita ativa
  mais recente que ainda não tem rastro (`GET /api/visitas/ativas`). Se em
  5 s não houver visita, é invasão. Rastro que o ByteTrack perde e reaparece
  perto herda a visita.
- **Prateleira**: só compara quando não há ninguém na frente da zona e a
  imagem ficou parada por alguns quadros. Compara com a última imagem
  parada; mudança geral de luz é descontada.
- **Eventos**: gravados primeiro em `dados/fila/` e enviados em ordem para
  `POST /api/visao/eventos`. Loja fora do ar = ficam na fila. Evento que a
  loja recusa (400) vira `.rejeitado` e não trava os outros.
- **Imagens**: `dados/eventos/AAAA-MM-DD/`, JPEG de até 1280 px e 300 KB,
  apagadas depois de `dados.diasGuardar` dias.

## Limitações conhecidas

- O vínculo rastro ↔ visita é por ordem de chegada, sem rosto: duas pessoas
  entrando juntas podem ficar trocadas. Câmera que não vê a porta só sabe de
  quem é o rastro quando há uma única visita na loja; fora disso o evento
  vai com `rastrosSemVisita` e a loja resolve no fechamento por período.
- O detector por diferença diz "saiu/voltou" e estima a quantidade pela
  área; não conta itens. Para contar é preciso o modelo SKU-110K (não há
  pesos no projeto: baixar um já treinado ou treinar numa máquina com GPU).
- Sirene e barreira de luz são simuladas (`pili_visao/porta.py`): falta a
  classe que fala com o ESP32 da porta.
- O PyTorch instalado neste notebook é só de CPU; ver `medir_fps.py`.

## Seguir a pessoa de uma câmera para a outra (11/11/2026)

Cada câmera pode ter o **chão calibrado**: 4 ou mais pontos do piso, com a posição de cada um em metros na planta da loja (X a partir da parede esquerda, Y a partir do fundo — o mesmo canto para todas as câmeras). Com isso o programa converte o pé de cada pessoa em metros na planta, e **dois rastros no mesmo ponto do chão ao mesmo tempo são a mesma pessoa**: a câmera nova herda a visita que a outra já conhecia. Também cobre ponto cego (some numa câmera e reaparece perto, em até 15 s, na outra).

- Calibrar: `python calibrar_chao.py NOME_DA_CAMERA` (clica os pontos na imagem e digita as medidas). Grava `"chao"` na câmera, no `config.json`. Tamanho da loja e tolerâncias em `"planta"`.
- Câmera sem `"chao"` continua como antes (só sabe quem é quando há uma pessoa só na loja ou quando a pessoa nasce na zona da porta).
- Duas pessoas coladas (menos de ~30 cm de diferença) → o programa **não chuta**: o rastro fica sem dono até separarem.
- Não usa aparência (roupa/rosto): só posição. Limite conhecido: duas pessoas que trocam de lugar dentro de um ponto cego podem sair trocadas.

## Trajeto de cada visita

Enquanto a pessoa está na loja, o programa grava em `dados/trajetos/<visita>/` os pontos do percurso (2 por segundo), em que prateleira ela esteve e uma foto a cada 2 s (1 s junto a prateleira). Apaga sozinho depois de `diasGuardar` dias.

Quando a loja fecha um período com **item faltando**, ela passa a pedir (`GET /api/visao/pedidos`) o trajeto de quem esteve junto às prateleiras de onde saiu item. O programa monta, por pessoa, um **mapa do percurso** (na planta; sem calibração, sobre a imagem de cada câmera) e até duas **folhas de fotos** com hora, câmera e prateleira, e devolve (`POST /api/visao/trajetos`). A loja guarda na divergência e manda um aviso ao dono com as imagens.

Nunca testado com câmeras reais: os testes usam rastros injetados (`testes/test_entre_cameras.py`). A precisão da calibração e o raio de 0,8 m precisam ser conferidos na loja montada.

## Ajuste fino do detector de pessoas para câmera de teto

O modelo vem treinado com fotos de pessoas vistas de frente ou de lado. Vista
do teto, a pessoa vira "cabeça e ombros" e ele erra mais. O ajuste fino é
ensinar o mesmo modelo com fotos das **nossas** câmeras, já instaladas no
lugar definitivo. Só vale fazer depois de as câmeras estarem fixas: mudar a
altura ou o ângulo muda a aparência das pessoas.

> **Cuidado com as imagens (LGPD).** Os quadros mostram pessoas. Grave o vídeo
> de treino com funcionários e convidados que saibam para que é, não com
> clientes. E antes de subir qualquer imagem para um serviço na internet
> (Roboflow), confira no site se o seu plano deixa o projeto **público** —
> planos gratuitos costumam deixar. Na dúvida, use o LabelImg, que roda só
> neste computador.

### Ferramentas de anotação

| Ferramenta | O que é | Quando usar |
|---|---|---|
| **Roboflow** | Site (roboflow.com). Não instala nada: sobe as imagens, desenha as caixas no navegador, divide treino/validação e exporta em vários formatos. Tem "Label Assist", que sugere as caixas. | Mais rápido e confortável, se as imagens puderem sair do computador. |
| **LabelImg** | Programa que roda neste computador, sem internet. Grava direto no formato YOLO. O projeto está arquivado (não recebe mais correções), mas funciona. | Quando as imagens não podem sair daqui. |

**Instalar o Roboflow**: nada a instalar. Crie a conta em roboflow.com, crie
um projeto do tipo *Object Detection* com uma classe só, `pessoa`.

**Instalar o LabelImg** (num ambiente separado, para não misturar com o do programa):

```
py -3.10 -m venv C:\ferramentas\labelimg
C:\ferramentas\labelimg\Scripts\pip install labelImg
C:\ferramentas\labelimg\Scripts\labelImg
```

Se ele fechar sozinho ao desenhar uma caixa (erro `setValue ... float` na
janela preta): é um defeito conhecido da versão do `pip` com Python 3.10 ou
mais novo. Saídas relatadas: instalar a versão do repositório
(`pip install git+https://github.com/HumanSignal/labelImg.git`) ou usar
Python 3.9. *Esta instalação não foi testada neste computador.*

No LabelImg: `Open Dir` (pasta das imagens), `Change Save Dir` (a mesma
pasta), clique no botão de formato até aparecer **YOLO**, e ligue
`View > Auto Save mode`. Teclas: `W` desenha a caixa, `D` próxima imagem,
`A` anterior.

### O fluxo completo, do vídeo ao dataset

1. **Gravar.** Com as câmeras no lugar definitivo, grave de cada uma (pelo
   programa da câmera ou pelo VLC, em `Mídia > Abrir fluxo de rede` com o
   endereço RTSP e `Converter/Salvar`). Faça as pessoas andarem pela loja
   inteira: junto às prateleiras, na porta, no caixa, nas bordas da imagem,
   abaixadas, de mochila, de boné, duas e três juntas e se cruzando. Grave em
   pelo menos **dois horários** (luz do dia e luz acesa) e deixe uns trechos
   com a loja **vazia**. Uns 10 a 15 minutos por câmera bastam.
2. **Tirar os quadros.** Um a cada 2 segundos, pulando os repetidos:

   ```
   .venv\Scripts\python ferramentas\extrair_quadros.py gravacao_cam1.mp4 --saida dataset\todas --intervalo 2
   ```

3. **Separar treino e validação ANTES de anotar.** Ponha em `dataset\valid`
   os quadros de uma gravação inteira (um horário ou um dia diferente) e o
   resto em `dataset\train` — cerca de 80% / 20%. Não sorteie quadros soltos:
   quadros vizinhos do mesmo vídeo são quase iguais e a validação daria uma
   nota boa demais, falsa.
4. **Anotar.** Uma caixa por pessoa, justa, pegando o corpo inteiro que
   aparece (inclusive quem está cortado na borda ou meio encoberto por
   prateleira). Classe única: `pessoa`. Quadro sem ninguém fica **sem caixa**
   — ele ensina o modelo a não ver gente em prateleira e sombra. Não anote
   reflexo em vidro nem pessoa em cartaz.
5. **Conferir.** Passe por todas as imagens uma segunda vez. Caixa esquecida
   é o erro que mais estraga o treino.
6. **Exportar no formato YOLO.**
   - Roboflow: `Generate` (sem aumento de dados nesta primeira vez; redimensionar
     para 640) → `Export Dataset` → formato **YOLOv8** (ou "YOLOv5 PyTorch") →
     baixar o zip. Vem com `train/images`, `train/labels`, `valid/...` e um
     `data.yaml`.
   - LabelImg: já grava assim — um `.txt` ao lado de cada imagem, mais um
     `classes.txt`.

   Cada `.txt` tem uma linha por pessoa: `0 centro_x centro_y largura altura`,
   tudo de 0 a 1 em relação ao tamanho da imagem.
7. **Converter para o treino do YOLOX.** O nosso detector (YOLOX) treina com
   COCO JSON, não com os `.txt`. A conversão é um comando por pasta:

   ```
   .venv\Scripts\python ferramentas\yolo_para_coco.py dataset\train --saida dataset\train.json
   .venv\Scripts\python ferramentas\yolo_para_coco.py dataset\valid --saida dataset\valid.json
   ```

   (No Roboflow dá para exportar direto em **COCO JSON** e pular este passo.)

### Quantos quadros anotar

Regra prática, **não medida aqui** — o número certo só aparece testando:

| | Quadros anotados | Observação |
|---|---|---|
| **Mínimo viável** | **300 a 500**, somando as câmeras, com pelo menos ~1.000 caixas de pessoa | Dá para ver se o ajuste fino melhora. Abaixo disso o modelo tende a decorar as poucas pessoas do vídeo. |
| Recomendado | 1.500 a 2.000 | Vários dias, roupas e horários diferentes. |
| Sem ninguém | 10% a 15% do total | Loja vazia, com luz diferente. |
| Validação | 20% do total, de gravação separada | Nunca do mesmo trecho do treino. |

Vale mais variedade (pessoas, roupas, horários, posições) do que quantidade:
500 quadros de dez pessoas diferentes ensinam mais do que 2.000 da mesma
pessoa. Depois do primeiro treino, anote de preferência os quadros em que o
modelo **errou** (pessoa não vista, prateleira vista como pessoa).

### Depois do dataset

O treino precisa de placa de vídeo (o PC da loja com a RTX, ou um serviço
como o Colab) e é feito com o repositório oficial do YOLOX, partindo dos
pesos `yolox_tiny` ou `yolox_s`; no fim exporta-se para ONNX, copia-se o
arquivo para `modelos/` e aponta-se `pessoas.pesos` no `config.json`. Esse
passo ainda **não foi feito nem testado** neste projeto — o roteiro detalhado
entra aqui quando houver o primeiro dataset.

Para saber se melhorou: rode `python medir_fps.py --fonte gravacao.mp4` antes
e depois, e confira à mão uns 50 quadros da validação.
