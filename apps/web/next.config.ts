import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  experimental: {
    serverActions: {
      // O parser de PDF (so o Cora, ver packages/statements/src/node/cora.ts)
      // roda no servidor via Server Action — o arquivo inteiro vai em base64
      // no corpo da requisicao (~33% maior que o arquivo original). O padrao
      // do Next e 1mb, curto demais pra um extrato de varias paginas ou um
      // PDF escaneado/fotografado: o corpo estourava o limite ANTES da acao
      // rodar, e o cliente via um erro cru do React em vez da mensagem
      // amigavel que parsePdfStatement ja devolve pra PDF invalido/de outro
      // banco. parse-file.ts recusa client-side qualquer arquivo maior que
      // isto comporta (ver limite la), pra nunca estourar de novo.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
