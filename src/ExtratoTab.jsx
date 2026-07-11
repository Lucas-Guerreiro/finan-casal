import { useState, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// ─── Paleta idêntica ao App.jsx ────────────────────────────────────────────
const CLR = {
  entrada:  { bg:"#0d3d2e", border:"#1a6647", text:"#2ecc8f" },
  prevista: { bg:"#2a2a10", border:"#6b6b10", text:"#d4c22a" },
  gasto:    { bg:"#3d1515", border:"#6b2525", text:"#e05555" },
  parcela:  { bg:"#1a1a3d", border:"#3a3a7a", text:"#7b8cde" },
  neutral:  { bg:"#1e1e2e", card:"#25253a", border:"#333355", muted:"#6b7280", label:"#a0aec0" },
};
const baseInput = { background:CLR.neutral.card, border:`1px solid ${CLR.neutral.border}`, borderRadius:8, color:"#e2e8f0", padding:"8px 12px", fontSize:13, width:"100%", outline:"none", boxSizing:"border-box" };
const baseBtn   = { borderRadius:8, border:"none", cursor:"pointer", fontSize:13, fontWeight:500, padding:"8px 14px" };
function fmt(v) { return "R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }

// ─── Dicionário de meses em PT-BR ──────────────────────────────────────────
const MESES_NUM = {
  Janeiro:1, Fevereiro:2, "Março":3, Abril:4, Maio:5, Junho:6,
  Julho:7, Agosto:8, Setembro:9, Outubro:10, Novembro:11, Dezembro:12
};

// ─── Sugestão automática de categoria ──────────────────────────────────────
function sugerirCategoria(tipo, descricao) {
  const txt = (tipo + " " + descricao).toUpperCase();
  if (/CARTAO|FATURA|FAT\s|CREDITO/.test(txt))              return "Outros";
  if (/TARIFA|MANUTENCAO|ALUGUEL|CONDOMIN|IPTU|LUZ|AGUA|GAS/.test(txt)) return "Moradia";
  if (/MERCADO|SUPER|PANCO|PADARIA|RESTAU|IFOOD|RAPPI|ALIMENT|HORTIFRUTI/.test(txt)) return "Alimentação";
  if (/POSTO|COMBUST|GASOLINA|UBER|99POP|TAXI|ONIBUS|METRO|PEDAGIO/.test(txt)) return "Transporte";
  if (/FARMAC|DROGARIA|MEDIC|CLINICA|HOSPITAL|PLANO\sSAUD|SAUDE/.test(txt)) return "Saúde";
  if (/ESCOLA|FACUL|CURSO|LIVRO|APOSTIL|EDUCA/.test(txt))  return "Educação";
  if (/NETFLIX|SPOTIFY|AMAZON|CINEMA|TEATRO|SHOW|LAZER|VIAGEM|HOTEL/.test(txt)) return "Lazer";
  if (/ROUPA|CALCADO|VEST|ZARA|RENNER|MARISA|C\&A/.test(txt)) return "Vestuário";
  return "Outros";
}

// ─── Extração de texto com posicionamento (Y grouping) ─────────────────────
async function extrairLinhasPDF(file, password = "") {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer, password: password }).promise;
  const todasLinhas = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const vp      = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const byY = {};
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      // Converte para coordenada top-down
      const y = Math.round((vp.height - item.transform[5]) / 4) * 4;
      if (!byY[y]) byY[y] = [];
      byY[y].push({ text: item.str.trim(), x: item.transform[4] });
    }

    const linhasPagina = Object.entries(byY)
      .sort(([ya], [yb]) => Number(ya) - Number(yb))
      .map(([, items]) =>
        items.sort((a, b) => a.x - b.x).map(i => i.text)
      );

    todasLinhas.push(...linhasPagina);
  }

  return todasLinhas;
}

// ─── Parser principal C6Bank ────────────────────────────────────────────────
function parsearExtratoCasal(linhas, categoriasDisponiveis) {
  const transacoes = [];
  let anoAtual  = new Date().getFullYear();
  let mesAtual  = new Date().getMonth() + 1;
  let idBase    = Date.now();

  for (const cells of linhas) {
    const texto = cells.join(" ");

    // ── Cabeçalho de mês: "Outubro 2025" ──────────────────────────────────
    const mesMatch = texto.match(
      /(Janeiro|Fevereiro|Mar[çc]o|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s+(\d{4})/
    );
    if (mesMatch && !/^\d{2}\/\d{2}/.test(cells[0] || "")) {
      const nomeNorm = mesMatch[1].replace("Marco","Março").replace("Marêo","Março");
      mesAtual = MESES_NUM[nomeNorm] ?? mesAtual;
      anoAtual = parseInt(mesMatch[2]);
      continue;
    }

    // ── Linha de transação: 1ª célula = DD/MM ─────────────────────────────
    if (!/^\d{2}\/\d{2}$/.test(cells[0] ?? "")) continue;
    const dia = cells[0].split("/")[0];

    // Encontra o índice da célula de valor (último com padrão monetário)
    const valorIdx = [...cells].reduceRight((found, c, i) => {
      if (found !== -1) return found;
      if (/^-?R?\$?\s*[\d.,]+$/.test(c.replace(/\s/g,""))) return i;
      return -1;
    }, -1);
    if (valorIdx === -1) continue;

    const valorRaw = cells[valorIdx]
      .replace("R$","").replace(/\s/g,"")
      .replace(/\./g,"").replace(",",".");
    const valorNum = parseFloat(valorRaw);
    if (isNaN(valorNum)) continue;

    // tipo: célula 2 (índice 2), descrção: entre tipo e valor
    const tipo      = cells[2] ?? "";
    const descricao = cells.slice(3, valorIdx).join(" ").trim() || tipo;
    const dataISO   = `${anoAtual}-${String(mesAtual).padStart(2,"0")}-${dia.padStart(2,"0")}`;
    const isEntrada = valorNum > 0;

    const catSugerida = isEntrada
      ? "Outros"
      : (sugerirCategoria(tipo, descricao) in
          Object.fromEntries([...["Moradia","Alimentação","Transporte","Saúde","Educação","Lazer","Vestuário","Outros",...(categoriasDisponiveis??[])].map(c=>[c,1])])
          ? sugerirCategoria(tipo, descricao)
          : "Outros");

    transacoes.push({
      id:          idBase++,
      data:        dataISO,
      tipo,
      descricao:   descricao || tipo,
      valor:       Math.abs(valorNum),
      isEntrada,
      status:      "pendente",   // pendente | adicionado | ignorado
      // Campos editáveis pelo usuário antes de importar
      editDescricao: descricao || tipo,
      editCategoria: catSugerida,
      editResponsavel: "Casal",
      editQuem:    "Lucas",
    });
  }

  return transacoes;
}

// ─── Componente principal da aba ────────────────────────────────────────────
export default function ExtratoTab({ categorias, onImportarItens, showToast }) {
  const [itens, setItens]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [nomeArq, setNomeArq]     = useState("");
  const [dragOver, setDragOver]   = useState(false);
  const [expandido, setExpandido] = useState(null); // id do item com edição expandida
  const [erroSenha, setErroSenha] = useState(false);
  const [senhaTemp, setSenhaTemp] = useState("");
  const [arquivoPendente, setArquivoPendente] = useState(null);
  const fileRef = useRef(null);

  const RESPONSAVEIS = ["Casal","Lucas","Lene"];
  const pendentes   = itens.filter(i => i.status === "pendente");
  const adicionados = itens.filter(i => i.status === "adicionado").length;
  const ignorados   = itens.filter(i => i.status === "ignorado").length;

  // ── Lê o PDF e popular itens ──────────────────────────────────────────────
  async function processarPDF(file, password = "") {
    if (!file || !file.name.endsWith(".pdf")) {
      showToast("Selecione um arquivo .pdf de extrato bancário.");
      return;
    }
    setLoading(true);
    setItens([]);
    setNomeArq(file.name);
    try {
      const linhas  = await extrairLinhasPDF(file, password);
      const parsed  = parsearExtratoCasal(linhas, categorias);
      if (parsed.length === 0) {
        showToast("Nenhuma transação encontrada. Verifique se o PDF é um extrato C6Bank válido.");
      } else {
        setItens(parsed);
        showToast(`✓ ${parsed.length} transação(ões) identificada(s)!`);
        setErroSenha(false);
        setArquivoPendente(null);
      }
    } catch (e) {
      console.error(e);
      if (e.name === "PasswordException" || e.code === 1 || e.message?.includes("password")) {
        setErroSenha(true);
        setSenhaTemp("");
        setArquivoPendente(file);
        showToast("Este extrato PDF está protegido por senha.");
      } else {
        showToast("Erro ao ler o PDF. Verifique se o arquivo não está corrompido.");
      }
    }
    setLoading(false);
  }

  // ── Atualiza campo editável de um item ────────────────────────────────────
  function editarItem(id, campo, valor) {
    setItens(prev => prev.map(i => i.id === id ? { ...i, [campo]: valor } : i));
  }

  // ── Importa itens no sistema (individualmente ou em lote) ─────────────────
  function importarItens(lista) {
    if (lista.length === 0) return;

    const itensAAdicionar = lista.map(item => {
      if (item.isEntrada) {
        return {
          tipo: "entrada",
          dados: {
            id: item.id,
            descricao: item.editDescricao,
            valor: item.valor,
            quem: item.editQuem,
            data: item.data,
            previsto: false,
            efetivado: true
          }
        };
      } else {
        return {
          tipo: "gasto",
          dados: {
            id: item.id,
            grupoId: undefined,
            descricao: item.editDescricao,
            valor: item.valor,
            categoria: item.editCategoria,
            responsavel: item.editResponsavel,
            data: item.data,
            parcela: 1,
            totalParcelas: 1,
            previsto: false,
            efetivado: true
          }
        };
      }
    });

    onImportarItens(itensAAdicionar);

    const ids = lista.map(i => i.id);
    setItens(prev => prev.map(i => ids.includes(i.id) ? { ...i, status: "adicionado" } : i));
    setExpandido(null);
  }

  // ── Adiciona um item individualmente ─────────────────────────────────────
  function adicionarItem(item) {
    importarItens([item]);
  }

  // ── Ignora um item ────────────────────────────────────────────────────────
  function ignorarItem(id) {
    setItens(prev => prev.map(i => i.id === id ? { ...i, status: "ignorado" } : i));
    if (expandido === id) setExpandido(null);
  }

  // ── Importa todos os pendentes ────────────────────────────────────────────
  function importarTodos() {
    importarItens(pendentes);
    showToast(`✓ ${pendentes.length} lançamento(s) importado(s)!`);
  }

  // ── Resetar ───────────────────────────────────────────────────────────────
  function resetar() {
    setItens([]);
    setNomeArq("");
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── Cor do card por tipo ──────────────────────────────────────────────────
  const cor = (item) =>
    item.status === "adicionado" ? CLR.entrada :
    item.status === "ignorado"   ? { bg:"#1e1e2e", border:"#333355", text:"#555577" } :
    item.isEntrada               ? CLR.entrada  : CLR.gasto;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Prompt de Senha para PDF Protegido ── */}
      {erroSenha && !loading && (
        <div style={{
          background: CLR.neutral.card,
          border: `1px solid ${CLR.gasto.border}`,
          borderRadius: 16,
          padding: "2rem",
          maxWidth: 400,
          margin: "0 auto 20px auto",
          boxShadow: `0 0 24px ${CLR.gasto.text}11`,
          display: "grid",
          gap: 14
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🔒</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: CLR.gasto.text, marginBottom: 4 }}>
              Este arquivo PDF está protegido por senha
            </div>
            <div style={{ fontSize: 12, color: CLR.neutral.label, lineHeight: 1.4, marginBottom: 6 }}>
              Extratos de banco costumam ser protegidos pelo CPF do titular (apenas números ou com pontos e traço). Digite a senha para abrir o arquivo:
            </div>
          </div>

          <div>
            <input
              type="password"
              placeholder="Digite a senha do PDF"
              value={senhaTemp}
              onChange={e => setSenhaTemp(e.target.value)}
              style={baseInput}
              onKeyDown={e => e.key === "Enter" && processarPDF(arquivoPendente, senhaTemp)}
            />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => { setErroSenha(false); setArquivoPendente(null); }}
              style={{ ...baseBtn, flex: 1, background: CLR.neutral.bg, color: "#e2e8f0", border: `1px solid ${CLR.neutral.border}` }}
            >
              Cancelar
            </button>
            <button
              onClick={() => processarPDF(arquivoPendente, senhaTemp)}
              style={{ ...baseBtn, flex: 1, background: CLR.gasto.bg, color: CLR.gasto.text, border: `1px solid ${CLR.gasto.border}`, fontWeight: 700 }}
            >
              Desbloquear
            </button>
          </div>
        </div>
      )}

      {/* ── Área de upload ── */}
      {itens.length === 0 && !erroSenha && !loading && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); processarPDF(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? CLR.parcela.text : CLR.neutral.border}`,
            borderRadius: 16,
            padding: "3rem 2rem",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? CLR.parcela.bg : "transparent",
            transition: "all 0.2s",
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 10 }}>📄</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0", marginBottom: 6 }}>
            Arraste o extrato PDF ou clique para selecionar
          </div>
          <div style={{ fontSize: 12, color: CLR.neutral.muted }}>
            Compatível com extratos do <strong style={{ color: CLR.parcela.text }}>C6Bank</strong> em formato PDF
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            style={{ display: "none" }}
            onChange={e => processarPDF(e.target.files[0])}
          />
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div style={{ textAlign: "center", padding: "3rem 0", color: CLR.neutral.label }}>
          <div style={{ fontSize: 36, marginBottom: 14, animation: "spin 1s linear infinite" }}>⏳</div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Lendo o extrato PDF...</div>
          <div style={{ fontSize: 12, color: CLR.neutral.muted, marginTop: 6 }}>
            Isso pode levar alguns segundos dependendo do tamanho do arquivo.
          </div>
        </div>
      )}

      {/* ── Cabeçalho de resultado ── */}
      {itens.length > 0 && !loading && (
        <>
          {/* Barra de status geral */}
          <div style={{
            background: CLR.neutral.card,
            border: `1px solid ${CLR.neutral.border}`,
            borderRadius: 12,
            padding: "14px 18px",
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 2 }}>
                📄 {nomeArq}
              </div>
              <div style={{ fontSize: 12, color: CLR.neutral.muted, display: "flex", gap: 14 }}>
                <span>Total: <strong style={{ color: "#e2e8f0" }}>{itens.length}</strong></span>
                <span style={{ color: CLR.entrada.text }}>✓ Adicionados: <strong>{adicionados}</strong></span>
                <span style={{ color: CLR.prevista.text }}>⏳ Pendentes: <strong>{pendentes.length}</strong></span>
                <span style={{ color: CLR.neutral.muted }}>— Ignorados: <strong>{ignorados}</strong></span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {pendentes.length > 0 && (
                <button
                  onClick={importarTodos}
                  style={{ ...baseBtn, background: "linear-gradient(90deg,#0d3d2e,#1a6647)", color: CLR.entrada.text, border: `1px solid ${CLR.entrada.border}`, fontWeight: 700 }}
                >
                  ⊕ Importar todos ({pendentes.length})
                </button>
              )}
              <button
                onClick={resetar}
                style={{ ...baseBtn, background: CLR.gasto.bg, color: CLR.gasto.text, border: `1px solid ${CLR.gasto.border}` }}
              >
                🗑 Limpar
              </button>
            </div>
          </div>

          {/* Lista de transações agrupadas por mês */}
          {(() => {
            // Agrupar por ano-mês
            const grupos = {};
            for (const item of itens) {
              const chave = item.data.slice(0, 7); // "2025-10"
              if (!grupos[chave]) grupos[chave] = [];
              grupos[chave].push(item);
            }
            const MESES_LABEL = ["","Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

            return Object.entries(grupos)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([chave, grupo]) => {
                const [ano, mes] = chave.split("-").map(Number);
                const eMesPendentes = grupo.filter(i => i.status === "pendente").length;
                return (
                  <div key={chave} style={{ marginBottom: 24 }}>
                    {/* Cabeçalho do mês */}
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 0", marginBottom: 8,
                      borderBottom: `2px solid ${CLR.neutral.border}`,
                    }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>
                        {MESES_LABEL[mes]} {ano}
                      </div>
                      <div style={{ display: "flex", gap: 12, fontSize: 12, color: CLR.neutral.muted }}>
                        <span style={{ color: CLR.entrada.text }}>
                          Entradas: {fmt(grupo.filter(i=>i.isEntrada&&i.status!=="ignorado").reduce((s,i)=>s+i.valor,0))}
                        </span>
                        <span style={{ color: CLR.gasto.text }}>
                          Gastos: {fmt(grupo.filter(i=>!i.isEntrada&&i.status!=="ignorado").reduce((s,i)=>s+i.valor,0))}
                        </span>
                        {eMesPendentes > 0 && (
                          <span style={{ color: CLR.prevista.text }}>{eMesPendentes} pendente(s)</span>
                        )}
                      </div>
                    </div>

                    {/* Cards de transação */}
                    {grupo.map(item => {
                      const c = cor(item);
                      const isExp = expandido === item.id;
                      const isIgnorado  = item.status === "ignorado";
                      const isAdicionado = item.status === "adicionado";

                      return (
                        <div key={item.id} style={{
                          background: CLR.neutral.card,
                          border: `1px solid ${CLR.neutral.border}`,
                          borderLeft: `4px solid ${c.text}`,
                          borderRadius: 10,
                          marginBottom: 8,
                          opacity: isIgnorado ? 0.45 : 1,
                          transition: "opacity 0.2s",
                        }}>
                          {/* Linha principal do card */}
                          <div style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "10px 14px",
                            gap: 10,
                            flexWrap: "wrap",
                          }}>
                            {/* Ícone + info */}
                            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                              <div style={{
                                width: 34, height: 34, borderRadius: "50%",
                                background: c.bg, border: `1px solid ${c.border}`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 15, flexShrink: 0,
                              }}>
                                {isAdicionado ? "✓" : item.isEntrada ? "↑" : "↓"}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{
                                  fontSize: 13, fontWeight: 500, color: isIgnorado ? CLR.neutral.muted : "#e2e8f0",
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>
                                  {item.editDescricao}
                                </div>
                                <div style={{ fontSize: 11, color: CLR.neutral.muted, marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  <span style={{ background: c.text+"22", color: c.text, border: `1px solid ${c.text}44`, borderRadius: 99, padding: "1px 7px" }}>
                                    {item.isEntrada ? "Entrada" : item.editCategoria}
                                  </span>
                                  {!item.isEntrada && (
                                    <span style={{ background: CLR.neutral.bg, color: CLR.neutral.label, border: `1px solid ${CLR.neutral.border}`, borderRadius: 99, padding: "1px 7px" }}>
                                      {item.editResponsavel}
                                    </span>
                                  )}
                                  <span>{item.data}</span>
                                  <span style={{ color: CLR.neutral.muted, fontStyle: "italic" }}>{item.tipo}</span>
                                </div>
                              </div>
                            </div>

                            {/* Valor + ações */}
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              <span style={{ fontWeight: 700, fontSize: 15, color: c.text }}>
                                {fmt(item.valor)}
                              </span>

                              {!isIgnorado && !isAdicionado && (
                                <>
                                  <button
                                    onClick={() => setExpandido(isExp ? null : item.id)}
                                    title="Editar antes de adicionar"
                                    style={{ ...baseBtn, background: CLR.neutral.bg, color: CLR.neutral.label, border: `1px solid ${CLR.neutral.border}`, padding: "5px 9px", fontSize: 12 }}
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    onClick={() => adicionarItem(item)}
                                    title="Adicionar ao sistema"
                                    style={{ ...baseBtn, background: c.bg, color: c.text, border: `1px solid ${c.border}`, padding: "5px 9px", fontSize: 12, fontWeight: 700 }}
                                  >
                                    ⊕ Add
                                  </button>
                                  <button
                                    onClick={() => ignorarItem(item.id)}
                                    title="Ignorar este lançamento"
                                    style={{ ...baseBtn, background: "#1e1e2e", color: CLR.neutral.muted, border: `1px solid ${CLR.neutral.border}`, padding: "5px 9px", fontSize: 12 }}
                                  >
                                    —
                                  </button>
                                </>
                              )}

                              {isAdicionado && (
                                <span style={{ fontSize: 12, color: CLR.entrada.text, fontWeight: 600 }}>✓ Adicionado</span>
                              )}
                              {isIgnorado && (
                                <button
                                  onClick={() => setItens(prev => prev.map(i => i.id === item.id ? { ...i, status: "pendente" } : i))}
                                  style={{ ...baseBtn, background: "none", color: CLR.neutral.muted, border: `1px solid ${CLR.neutral.border}`, padding: "4px 8px", fontSize: 11 }}
                                >
                                  ↩ Desfazer
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Painel de edição expandido */}
                          {isExp && (
                            <div style={{
                              borderTop: `1px solid ${CLR.neutral.border}`,
                              padding: "14px",
                              background: CLR.neutral.bg,
                              borderRadius: "0 0 8px 8px",
                              display: "grid",
                              gap: 10,
                            }}>
                              <div style={{ fontSize: 11, color: CLR.neutral.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
                                Editar antes de importar
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: CLR.neutral.muted, marginBottom: 4 }}>DESCRIÇÃO</div>
                                <input
                                  style={baseInput}
                                  value={item.editDescricao}
                                  onChange={e => editarItem(item.id, "editDescricao", e.target.value)}
                                />
                              </div>

                              {item.isEntrada ? (
                                <div>
                                  <div style={{ fontSize: 11, color: CLR.neutral.muted, marginBottom: 4 }}>QUEM RECEBEU</div>
                                  <select style={baseInput} value={item.editQuem} onChange={e => editarItem(item.id, "editQuem", e.target.value)}>
                                    <option>Lucas</option>
                                    <option>Lene</option>
                                  </select>
                                </div>
                              ) : (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                  <div>
                                    <div style={{ fontSize: 11, color: CLR.neutral.muted, marginBottom: 4 }}>CATEGORIA</div>
                                    <select style={baseInput} value={item.editCategoria} onChange={e => editarItem(item.id, "editCategoria", e.target.value)}>
                                      {categorias.map(c => <option key={c}>{c}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 11, color: CLR.neutral.muted, marginBottom: 4 }}>RESPONSÁVEL</div>
                                    <select style={baseInput} value={item.editResponsavel} onChange={e => editarItem(item.id, "editResponsavel", e.target.value)}>
                                      {RESPONSAVEIS.map(r => <option key={r}>{r}</option>)}
                                    </select>
                                  </div>
                                </div>
                              )}

                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                <div>
                                  <div style={{ fontSize: 11, color: CLR.neutral.muted, marginBottom: 4 }}>DATA</div>
                                  <input type="date" style={baseInput} value={item.data} onChange={e => editarItem(item.id, "data", e.target.value)} />
                                </div>
                                <div>
                                  <div style={{ fontSize: 11, color: CLR.neutral.muted, marginBottom: 4 }}>TIPO DE LANÇAMENTO</div>
                                  <select style={baseInput} value={item.isEntrada ? "entrada" : "gasto"} onChange={e => editarItem(item.id, "isEntrada", e.target.value === "entrada")}>
                                    <option value="entrada">Entrada</option>
                                    <option value="gasto">Gasto</option>
                                  </select>
                                </div>
                              </div>

                              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                                <button onClick={() => setExpandido(null)} style={{ ...baseBtn, flex: 1, background: CLR.neutral.card, color: "#e2e8f0", border: `1px solid ${CLR.neutral.border}` }}>Cancelar</button>
                                <button onClick={() => adicionarItem(item)} style={{ ...baseBtn, flex: 1, background: c.bg, color: c.text, border: `1px solid ${c.border}`, fontWeight: 700 }}>⊕ Confirmar e Adicionar</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              });
          })()}

          {/* Botão final de importar todos */}
          {pendentes.length > 0 && (
            <div style={{ position: "sticky", bottom: 16, marginTop: 8 }}>
              <button
                onClick={importarTodos}
                style={{
                  ...baseBtn,
                  background: "linear-gradient(90deg,#0d3d2e,#1a6647)",
                  color: CLR.entrada.text,
                  border: `1px solid ${CLR.entrada.border}`,
                  width: "100%",
                  padding: "14px",
                  fontSize: 14,
                  fontWeight: 700,
                  boxShadow: "0 4px 16px rgba(46,204,143,0.2)",
                }}
              >
                ⊕ Importar todos os {pendentes.length} lançamento(s) pendente(s)
              </button>
            </div>
          )}

          {pendentes.length === 0 && itens.length > 0 && (
            <div style={{ textAlign: "center", padding: "2rem 0", color: CLR.entrada.text, fontSize: 14, fontWeight: 600 }}>
              🎉 Todos os lançamentos foram processados!
            </div>
          )}
        </>
      )}
    </div>
  );
}
