# Reconhecimento facial da loja (`rosto/`)

Serviço local que diz **quem é** a pessoa numa imagem. Atende o totem
(compara só entre quem está dentro da loja) e a catraca Control iD em modo
Enterprise (compara com a base inteira). Roda no computador da loja, em
`127.0.0.1:3200`, sem internet e sem placa de vídeo.

Guarda só a **assinatura** do rosto (128 números), nunca a foto, em
`dados/assinaturas.bin`, cifrado com AES-256-GCM. A chave (`dados/chave.dpapi`)
é protegida pelo DPAPI do Windows: só abre na mesma conta, na mesma máquina.
Trocar de computador ou de conta do Windows = recadastrar os rostos a partir
das fotos da nuvem.

## Instalar e rodar

Dê dois cliques em `iniciar.bat` (cria o ambiente, baixa os modelos e sobe o
serviço). Precisa de Python 3.11 e, na primeira vez, de internet.

Toda chamada exige o header `x-loja-token`, igual ao conteúdo de
`loja/dados/token-local.txt` (ou, se o arquivo não existir, à variável
`LOJA_TOKEN_LOCAL`).

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /saude` | — | `{ok, clientes}` |
| `POST /cadastrar` | `{clienteId, imagemBase64}` | `{ok, clienteId}` ou 422 `{ok:false, erro}` com `SEM_ROSTO`, `MAIS_DE_UM_ROSTO`, `IMAGEM_INVALIDA` |
| `DELETE /clientes/{clienteId}` | — | `{ok, removido}` |
| `POST /identificar` | `{imagemBase64, candidatos?}` | `{encontrado, clienteId?, score, motivo?}` com motivo `SEM_ROSTO` ou `NAO_RECONHECIDO` |

Cadastrar o mesmo `clienteId` de novo substitui a assinatura. Em
`/identificar` vale o maior rosto da imagem.

## Testar

```
.venv\Scripts\python -m pytest tests          automático (baixa 2 imagens de exemplo)
.venv\Scripts\python medir_busca.py 50000     tempo da busca com base sintética
.venv\Scripts\python teste_webcam.py cadastrar giovani
.venv\Scripts\python teste_webcam.py identificar
```

## Calibrar o limiar

O `score` é a semelhança (cosseno) entre o rosto visto e o cadastrado, de -1 a 1.
Aceitar a pessoa errada é o erro caro; recusar a pessoa certa só faz ela
tentar de novo. Por isso os padrões são conservadores:

| Variável | Padrão | Uso |
|---|---|---|
| `ROSTO_LIMIAR_GERAL` | 0.50 | busca na base inteira (catraca) |
| `ROSTO_LIMIAR_CANDIDATOS` | 0.42 | busca entre `candidatos` (totem) |
| `ROSTO_MARGEM` | 0.05 | distância mínima entre o 1º e o 2º colocado |

**Estes números ainda não foram calibrados com clientes reais.** Para calibrar:
cadastre 20 a 30 pessoas, rode `teste_webcam.py identificar` com cada uma (com
e sem óculos, boné, luz diferente) e com pessoas não cadastradas, e anote os
scores. O limiar fica acima do maior score de "pessoa errada" e abaixo da
maioria dos scores de "pessoa certa". Quanto maior a base, mais alto ele deve
ficar. O modelo atual (SFace) é leve; com dezenas de milhares de clientes é
preciso medir a taxa de engano antes de confiar só no rosto para liberar a
entrada — o motor está isolado em `motor.py` para ser trocado sem mexer no resto.

## Modelos e licença

- Detecção: YuNet (`face_detection_yunet_2023mar.onnx`), licença MIT.
- Assinatura: SFace (`face_recognition_sface_2021dec.onnx`), licença Apache 2.0.

Os dois vêm do OpenCV Zoo e permitem uso comercial. Não foi usado o InsightFace
(os pesos prontos dele são só para pesquisa).

## Catraca Control iD — PROVISÓRIO

`controlid.py` recebe os eventos do modo Enterprise direto da catraca
(`/new_biometric_image.fcgi`), identifica o rosto, pergunta ao programa da loja
(`POST /api/entrada/autorizar`) e responde liberando o giro ou negando com a
mensagem. Foi escrito só pela documentação pública, sem o equipamento; os
pontos a confirmar estão no topo do arquivo.

Fica **desligado** até configurar:

| Variável | Para quê |
|---|---|
| `CONTROLID_IP` | IP da catraca; só chamadas vindas dele são atendidas |
| `CONTROLID_DEVICE_ID` | (opcional) número de série/`device_id` aceito |
| `CONTROLID_SENTIDO` | `clockwise` (padrão) ou `anticlockwise`: qual giro é "entrar" |
| `ROSTO_HOST` | trocar para o IP do computador na rede da loja, para a catraca alcançar |

Na catraca: `online` ligado, `local_identification` desligado e
`extract_template` desligado (o template é de formato proprietário e não serve
para o nosso motor).
