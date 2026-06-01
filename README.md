# ⚔️ Finanças Guerreiros (Lucas & Lene)

Bem-vindo ao **Finanças Guerreiros**, o sistema de gestão financeira do casal desenvolvido sob medida para Lucas e Lene. Esta versão moderna e robusta foi criada em **React (Vite)** e conta com integração completa ao **Firebase** para manter os dados do casal sempre online e sincronizados em tempo real entre múltiplos dispositivos!

Se as chaves do Firebase não estiverem configuradas, o aplicativo entra automaticamente no **Modo de Demonstração (Local)**, salvando as informações diretamente no seu navegador de forma segura para testes imediatos.

---

## 🚀 Como Iniciar o Projeto Localmente

1. **Instalar Dependências** (caso já não estejam instaladas):
   ```bash
   npm install
   ```

2. **Iniciar o Servidor de Desenvolvimento**:
   ```bash
   npm run dev
   ```
   *Abra o link exibido no terminal (geralmente `http://localhost:5173`) no seu navegador!*

3. **Gerar Versão de Produção (Build)**:
   ```bash
   npm run build
   ```

---

## 🔥 Como Configurar o Firebase (Sincronização em Tempo Real)

Para habilitar a sincronização online automática, siga os passos abaixo para criar o seu banco de dados gratuito no Firebase:

### Passo 1: Criar o Projeto no Firebase
1. Acesse o [Console do Firebase](https://console.firebase.google.com/).
2. Clique em **Adicionar projeto** (ou *Criar um projeto*).
3. Dê um nome ao projeto (ex: `Financas Guerreiros`) e avance.
4. Desative ou ative o Google Analytics (opcional) e clique em **Criar projeto**.

### Passo 2: Registrar o Aplicativo Web
1. Na página inicial do seu projeto no console, clique no ícone de **Web (</>)** para registrar um aplicativo.
2. Dê um apelido (ex: `FinancasWeb`) e clique em **Registrar app**.
3. O console exibirá um bloco de código com o objeto `firebaseConfig`. Copie os valores correspondentes às chaves!

### Passo 3: Criar o Arquivo `.env`
No diretório raiz deste projeto, edite o arquivo `.env` (que já foi criado com campos vazios) ou renomeie o `.env.example` para `.env` e preencha com as credenciais que você copiou:

```env
VITE_FIREBASE_API_KEY=AIzaSy...seu_valor_aqui...
VITE_FIREBASE_AUTH_DOMAIN=financas-guerreiros.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=financas-guerreiros
VITE_FIREBASE_STORAGE_BUCKET=financas-guerreiros.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef123456
```
*Após salvar o arquivo `.env`, reinicie o seu servidor local (`Ctrl+C` no terminal e `npm run dev` novamente).*

### Passo 4: Ativar o Firebase Auth (Autenticação)
1. No menu lateral esquerdo do console do Firebase, clique em **Autenticação** (Authentication) e depois em **Começar**.
2. Na aba **Método de login**, selecione **E-mail/senha**.
3. Ative a primeira opção (**E-mail/senha**) e clique em **Salvar**.
4. Na aba **Usuários**, você pode clicar em **Adicionar usuário** para cadastrar manualmente as contas (ex: `lucas@email.com` e `lene@email.com`), ou simplesmente cadastrar-se diretamente pela tela inicial do próprio aplicativo!

### Passo 5: Ativar o Cloud Firestore (Banco de Dados)
1. No menu lateral esquerdo, clique em **Cloud Firestore** e depois em **Criar banco de dados**.
2. Escolha o local do servidor (de preferência algum próximo, como `southamerica-east1` para São Paulo) e clique em **Avançar**.
3. Inicie em **Modo de teste** (para desenvolvimento rápido) ou **Modo de produção**.
4. Clique em **Criar**.
5. Acesse a aba **Regras** (Rules) do Firestore e garanta que a leitura e escrita estejam liberadas para usuários autenticados. Uma regra simples e segura é:
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /financas/{document} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
   Clique em **Publicar** após colar a regra acima.

Pronto! Agora, quando você e a Lene entrarem com seus logins individuais no app, todos os lançamentos de entradas, gastos, parcelas, categorias customizadas e limites de orçamento estarão sincronizados online na nuvem. Se um alterar algo, a tela do outro se atualiza **instantaneamente**!

---

## 🎨 Principais Funcionalidades

- **Painel Geral (Dashboard)**: Cards estatísticos de entradas, gastos e saldo mensal com barras de progresso elegantes por pessoa/responsável e gráficos categoria vs. orçamento.
- **Entradas**: Cadastro de receitas efetivadas ou previstas (com o emoji 🔮).
- **Gastos & Parcelamento**: Cadastro de gastos, com suporte avançado a parcelamentos no cartão (ex: lança `12` parcelas automáticas mensais consecutivas) e sinalizador de gastos previstos vs. efetivados.
- **Orçamentos & Categorias**: Crie categorias customizadas e defina limites mensais para controlar onde o dinheiro está indo.
- **Histórico Completo**: Linha do tempo completa e ordenada de todas as transações do mês selecionado.
- **Backup offline e Planilhas**: Baixe seus dados completos em `.json` ou exporte uma planilha em `.csv` a qualquer momento diretamente pela interface do aplicativo.
- **Pré-seleção Inteligente**: O app detecta quem está logado (Lucas ou Lene) e já pré-seleciona seu nome por padrão nos campos de lançamento!
