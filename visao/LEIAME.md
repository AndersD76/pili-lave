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

1. `iniciar.bat` — na primeira vez cria o ambiente `.venv` em cima do
   Python 3.10 que já tem o YOLO instalado. `iniciar.bat --mostrar` abre uma
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

- **Pessoas**: YOLO (`yolo11n`) + ByteTrack, uma instância por câmera.
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
