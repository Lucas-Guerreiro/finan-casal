import { useState, useEffect } from "react";
import { auth, db, isConfigured } from "./firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import ExtratoTab from "./ExtratoTab";

const STORAGE_KEY = "financas_casal_data_v4";
const CATEGORIAS_PADRAO = ["Moradia","Alimentação","Transporte","Saúde","Educação","Lazer","Vestuário","Outros"];
const RESPONSAVEIS = ["Casal","Lucas","Lene"];
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

const CLR = {
  entrada:  { bg:"#0d3d2e", border:"#1a6647", text:"#2ecc8f" },
  prevista: { bg:"#2a2a10", border:"#6b6b10", text:"#d4c22a" },
  gasto:    { bg:"#3d1515", border:"#6b2525", text:"#e05555" },
  parcela:  { bg:"#1a1a3d", border:"#3a3a7a", text:"#7b8cde" },
  neutral:  { bg:"#1e1e2e", card:"#25253a", border:"#333355", muted:"#6b7280", label:"#a0aec0" },
};

function fmt(v) { return "R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }
const defaultData = { entradas:[], gastos:[], orcamentos:{}, categoriasExtras:[] };
const baseInput = { background:CLR.neutral.card, border:`1px solid ${CLR.neutral.border}`, borderRadius:8, color:"#e2e8f0", padding:"8px 12px", fontSize:13, width:"100%", outline:"none", boxSizing:"border-box" };
const baseBtn = { borderRadius:8, border:"none", cursor:"pointer", fontSize:13, fontWeight:500, padding:"8px 14px" };

// Utilitário seguro de Storage (suporta localStorage padrão e window.storage)
const safeStorage = {
  async get(key) {
    try {
      if (window.storage && typeof window.storage.get === "function") {
        const r = await window.storage.get(key, true);
        return r?.value ? JSON.parse(r.value) : null;
      }
    } catch (e) {
      console.warn("Falha ao ler de window.storage, usando localStorage local", e);
    }
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : null;
  },
  async set(key, val) {
    try {
      if (window.storage && typeof window.storage.set === "function") {
        await window.storage.set(key, JSON.stringify(val), true);
        return;
      }
    } catch (e) {
      console.warn("Falha ao salvar em window.storage, usando localStorage local", e);
    }
    localStorage.setItem(key, JSON.stringify(val));
  }
};

function Badge({ color, children }) {
  return <span style={{ background:color+"22", color, border:`1px solid ${color}44`, borderRadius:99, fontSize:11, padding:"2px 8px", fontWeight:500 }}>{children}</span>;
}
function Card({ children, style }) {
  return <div style={{ background:CLR.neutral.card, border:`1px solid ${CLR.neutral.border}`, borderRadius:14, padding:"1rem", ...style }}>{children}</div>;
}
function InputField({ label, ...props }) {
  return (
    <div>
      {label && <div style={{ fontSize:11, color:CLR.neutral.muted, marginBottom:4, fontWeight:500, letterSpacing:0.5, textTransform:"uppercase" }}>{label}</div>}
      <input style={baseInput} {...props} />
    </div>
  );
}
function SelectField({ label, children, ...props }) {
  return (
    <div>
      {label && <div style={{ fontSize:11, color:CLR.neutral.muted, marginBottom:4, fontWeight:500, letterSpacing:0.5, textTransform:"uppercase" }}>{label}</div>}
      <select style={baseInput} {...props}>{children}</select>
    </div>
  );
}
function ProgressBar({ val, max }) {
  const pct = max>0 ? Math.min(100,(val/max)*100) : 0;
  const c = pct>=90 ? CLR.gasto.text : pct>=70 ? "#f59e0b" : CLR.entrada.text;
  return (
    <div style={{ height:6, background:CLR.neutral.border, borderRadius:99, overflow:"hidden" }}>
      <div style={{ height:6, width:`${pct}%`, background:c, borderRadius:99, transition:"width 0.4s" }}></div>
    </div>
  );
}
function StatCard({ label, value, icon, color, sub }) {
  return (
    <div style={{ background:color+"18", border:`1px solid ${color}44`, borderRadius:14, padding:"1rem" }}>
      <div style={{ fontSize:12, color:CLR.neutral.label, marginBottom:6, display:"flex", alignItems:"center", gap:5 }}><span>{icon}</span>{label}</div>
      <div style={{ fontSize:22, fontWeight:700, color }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:CLR.neutral.muted, marginTop:3 }}>{sub}</div>}
    </div>
  );
}
function Modal({ title, accent, onClose, children }) {
  const c = accent==="entrada" ? CLR.entrada : accent==="parcela" ? CLR.parcela : CLR.gasto;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:CLR.neutral.bg, border:`1px solid ${c.border}`, borderRadius:16, padding:"1.5rem", width:"100%", maxWidth:420, boxShadow:`0 0 32px ${c.text}22`, maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <span style={{ fontWeight:600, fontSize:15, color:c.text }}>{title}</span>
          <button onClick={onClose} style={{ ...baseBtn, background:"none", color:CLR.neutral.muted, padding:4 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function SearchBar({ value, onChange }) {
  return (
    <div style={{ position:"relative", marginBottom:14 }}>
      <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:CLR.neutral.muted, fontSize:14 }}>🔍</span>
      <input style={{ ...baseInput, paddingLeft:32 }} placeholder="Pesquisar descrição, categoria, responsável..." value={value} onChange={e=>onChange(e.target.value)} />
      {value && <button onClick={()=>onChange("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:CLR.neutral.muted }}>✕</button>}
    </div>
  );
}
function StatusBadge({ previsto, efetivado }) {
  if (!previsto) return null;
  if (efetivado) return <Badge color="#2ecc8f">✓ Efetivado</Badge>;
  return <Badge color="#d4c22a">⏳ Previsto</Badge>;
}
function ItemRow({ item, tipo, onEdit, onDelete, onEfetivar }) {
  const [expandido, setExpandido] = useState(false);
  const isParcela = item.totalParcelas > 1;
  const isPrevisto = !!item.previsto;
  const isEfetivado = !!item.efetivado;
  const c = tipo==="entrada"
    ? (isPrevisto && !isEfetivado ? CLR.prevista : CLR.entrada)
    : (isPrevisto && !isEfetivado ? CLR.prevista : isParcela ? CLR.parcela : CLR.gasto);
  const temItens = tipo === "gasto" && item.itens && item.itens.length > 0;

  return (
    <div style={{ display:"flex", flexDirection:"column", marginBottom: 8 }}>
      <div 
        onClick={() => temItens && setExpandido(!expandido)}
        style={{ 
          display:"flex", 
          justifyContent:"space-between", 
          alignItems:"center", 
          padding:"11px 14px", 
          background:CLR.neutral.card, 
          border:`1px solid ${CLR.neutral.border}`, 
          borderLeft:`3px solid ${c.text}`, 
          borderRadius: temItens && expandido ? "10px 10px 0 0" : 10,
          opacity:isPrevisto&&!isEfetivado?0.85:1,
          cursor: temItens ? "pointer" : "default",
          transition: "border-radius 0.2s"
        }}
      >
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:34, height:34, borderRadius:"50%", background:c.bg, border:`1px solid ${c.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>
            {tipo==="entrada" ? (isPrevisto&&!isEfetivado?"🔮":"↑") : (isPrevisto&&!isEfetivado?"🔮":isParcela?"💳":"↓")}
          </div>
          <div>
            <div style={{ fontSize:14, fontWeight:500, color:"#e2e8f0", display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
              {item.descricao}
              {isParcela && <span style={{ fontSize:11, background:CLR.parcela.bg, color:CLR.parcela.text, border:`1px solid ${CLR.parcela.border}`, borderRadius:99, padding:"1px 7px" }}>{item.parcela}/{item.totalParcelas}</span>}
              <StatusBadge previsto={isPrevisto} efetivado={isEfetivado} />
              {temItens && (
                <span style={{ 
                  fontSize: 10, 
                  background: CLR.neutral.bg, 
                  color: CLR.neutral.label, 
                  border: `1px solid ${CLR.neutral.border}`, 
                  borderRadius: 99, 
                  padding: "1px 6px", 
                  display: "inline-flex", 
                  alignItems: "center", 
                  gap: 3 
                }}>
                  📋 {item.itens.length} {item.itens.length === 1 ? "item" : "itens"} {expandido ? "▲" : "▼"}
                </span>
              )}
            </div>
            <div style={{ fontSize:11, color:CLR.neutral.muted, marginTop:2, display:"flex", gap:6, flexWrap:"wrap" }}>
              {tipo==="entrada"
                ? <><Badge color={c.text}>{item.quem}</Badge><span>{item.data}</span></>
                : <><Badge color={c.text}>{item.categoria}</Badge><Badge color={CLR.neutral.label}>{item.responsavel}</Badge><span>{item.data}</span></>}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap", justifyContent:"flex-end" }} onClick={e => e.stopPropagation()}>
          <span style={{ fontWeight:700, fontSize:15, color:c.text }}>{fmt(item.valor)}</span>
          {isPrevisto && !isEfetivado && (
            <button onClick={()=>onEfetivar(tipo,item.id)} style={{ ...baseBtn, background:"#0d3d2e", color:"#2ecc8f", border:"1px solid #1a6647", padding:"5px 9px", fontSize:12 }}>✓ Efetivar</button>
          )}
          <button onClick={()=>onEdit(tipo,item)} style={{ ...baseBtn, background:CLR.neutral.bg, color:CLR.neutral.label, border:`1px solid ${CLR.neutral.border}`, padding:"5px 9px" }}>✏️</button>
          <button onClick={()=>onDelete(tipo,item.id,item.grupoId)} style={{ ...baseBtn, background:CLR.gasto.bg, color:CLR.gasto.text, border:`1px solid ${CLR.gasto.border}`, padding:"5px 9px" }}>🗑</button>
        </div>
      </div>
      {temItens && expandido && (
        <div style={{
          background: "#1c1c2b",
          border: `1px solid ${CLR.neutral.border}`,
          borderTop: "none",
          borderRadius: "0 0 10px 10px",
          padding: "10px 14px 10px 48px",
          display: "grid",
          gap: 6
        }}>
          {item.itens.map((it, idx) => (
            <div key={idx} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:12, color:CLR.neutral.label }}>
              <span>▪ {it.descricao}</span>
              <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{fmt(it.valor)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function gerarParcelas(form, previsto, itens) {
  const total = parseInt(form.totalParcelas)||1;
  const grupoId = Date.now();
  const [ano,mes,dia] = form.data.split("-").map(Number);
  return Array.from({ length:total }, (_,i) => {
    const d = new Date(ano, mes-1+i, dia);
    const dataStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    return {
      id: grupoId + i,
      ...(total > 1 ? { grupoId } : {}),
      descricao: form.descricao,
      valor: parseFloat(form.valor),
      categoria: form.categoria,
      responsavel: form.responsavel,
      data: dataStr,
      parcela: i + 1,
      totalParcelas: total,
      previsto: previsto || false,
      efetivado: false,
      ...(itens && itens.length > 0 ? { itens } : {}),
    };
  });
}

function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type:mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); document.body.removeChild(a); }, 200);
}

// CONSTANTE DO ID DO DOCUMENTO DO CASAL NO FIRESTORE
const FIRESTORE_CASAL_ID = "casal_lucas_lene";

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState(defaultData);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [filtroMes, setFiltroMes] = useState(new Date().getMonth());
  const [filtroAno, setFiltroAno] = useState(new Date().getFullYear());
  const [tipoFiltro, setTipoFiltro] = useState("mensal");
  const [filtroDataInicio, setFiltroDataInicio] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [filtroDataFim, setFiltroDataFim] = useState(() => {
    const d = new Date();
    const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  });
  const [verPendenciasAnteriores, setVerPendenciasAnteriores] = useState(false);
  const [orcEdit, setOrcEdit] = useState({});
  const [search, setSearch] = useState("");
  const [gastosStatusFilter, setGastosStatusFilter] = useState({ previsto:true, efetivado:true, consolidado:true });
  const [novaCategoria, setNovaCategoria] = useState("");
  const hoje = new Date().toISOString().slice(0,10);

  // Estados de Autenticação do Firebase / Modo Local
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isModeOnline, setIsModeOnline] = useState(false);
  const [authForm, setAuthForm] = useState({ email: "", senha: "", quem: "Lucas" });
  const [isRegister, setIsRegister] = useState(false);
  const [authError, setAuthError] = useState("");

  const [formGasto, setFormGasto] = useState({ descricao:"", valor:"", categoria:CATEGORIAS_PADRAO[0], responsavel:"Casal", data:hoje, totalParcelas:"1" });
  const [formEntrada, setFormEntrada] = useState({ descricao:"", valor:"", quem:"Lucas", data:hoje });
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteScope, setDeleteScope] = useState("one");
  const [backupPreview, setBackupPreview] = useState(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Estados para detalhamento de sub-itens em gastos
  const [detalharItensForm, setDetalharItensForm] = useState(false);
  const [itensGastoForm, setItensGastoForm] = useState([]);
  const [novoItemDesc, setNovoItemDesc] = useState("");
  const [novoItemValor, setNovoItemValor] = useState("");
  const [editNovoItemDesc, setEditNovoItemDesc] = useState("");
  const [editNovoItemValor, setEditNovoItemValor] = useState("");

  // Estados para pagamento parcial (efetivação) de contas
  const [efetivandoItem, setEfetivandoItem] = useState(null);
  const [valorPagoForm, setValorPagoForm] = useState("");

  // Monitora o estado de Autenticação se o Firebase estiver configurado
  useEffect(() => {
    if (isConfigured && auth) {
      const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
        if (firebaseUser) {
          setUser(firebaseUser);
          setIsModeOnline(true);
          // Tenta identificar se o usuário é Lucas ou Lene pelo email cadastrado
          const email = firebaseUser.email.toLowerCase();
          let responsavelPadrao = "Casal";
          if (email.includes("lucas")) responsavelPadrao = "Lucas";
          else if (email.includes("lene")) responsavelPadrao = "Lene";

          // Ajusta os formulários padrão baseados em quem logou
          setFormGasto(f => ({ ...f, responsavel: responsavelPadrao }));
          setFormEntrada(f => ({ ...f, quem: responsavelPadrao === "Casal" ? "Lucas" : responsavelPadrao }));
        } else {
          setUser(null);
          setIsModeOnline(false);
        }
        setAuthLoading(false);
      });
      return () => unsubAuth();
    } else {
      // Sem Firebase configurado, carrega imediatamente em modo local
      setUser(null);
      setIsModeOnline(false);
    }
  }, []);

  // Controle de acesso à aba Extrato (permitida apenas para o Lucas)
  useEffect(() => {
    const isLucas = user && (
      (user.email && user.email.toLowerCase().includes("lucas")) ||
      (user.uid === "visitante_local" && (formGasto.responsavel === "Lucas" || authForm.quem === "Lucas"))
    );
    if (tab === "extrato" && !isLucas) {
      setTab("dashboard");
    }
  }, [tab, user, formGasto.responsavel, authForm.quem]);

  // Monitora e carrega os dados financeiros (Firestore em Tempo Real ou LocalStorage)
  useEffect(() => {
    // Só carrega os dados após sabermos o estado do usuário logado
    if (authLoading) return;

    setLoading(true);
    let unsubFirestore = () => {};

    if (isModeOnline && db && user) {
      // MODO ONLINE: Sincronização em tempo real via Firestore onSnapshot
      try {
        unsubFirestore = onSnapshot(doc(db, "financas", FIRESTORE_CASAL_ID), (docSnap) => {
          if (docSnap.exists()) {
            setData(docSnap.data());
          } else {
            setData(defaultData);
          }
          setLoading(false);
        }, (error) => {
          console.error("Erro na escuta do Firestore:", error);
          showToast("Erro de sincronização online.");
          setLoading(false);
        });
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    } else {
      // MODO LOCAL (Fallback LocalStorage/window.storage)
      safeStorage.get(STORAGE_KEY)
        .then((localVal) => {
          if (localVal) {
            setData(localVal);
          } else {
            setData(defaultData);
          }
          setLoading(false);
        })
        .catch(() => {
          setData(defaultData);
          setLoading(false);
        });
    }

    return () => unsubFirestore();
  }, [user, isModeOnline, authLoading]);

  function sanitizeFirestoreData(data) {
    return JSON.parse(
      JSON.stringify(data, (key, value) => {
        if (typeof value === "number") return Number.isNaN(value) ? null : value;
        return value;
      })
    );
  }

  // Função para salvar dados
  async function saveData(nd) {
    setSaving(true);
    if (isModeOnline && db && user) {
      // Salva no Firebase Firestore
      try {
        const sanitized = sanitizeFirestoreData(nd);
        await setDoc(doc(db, "financas", FIRESTORE_CASAL_ID), sanitized);
        showToast("✓ Sincronizado online!");
      } catch (e) {
        console.error("Erro ao salvar no Firestore:", e);
        console.error("Dados enviados ao Firestore:", sanitizeFirestoreData(nd));
        showToast("Erro ao sincronizar online: " + (e?.message || "verifique o console"));
      }
    } else {
      // Salva no LocalStorage
      try {
        await safeStorage.set(STORAGE_KEY, nd);
        showToast("✓ Salvo localmente!");
      } catch (e) {
        showToast("Erro ao salvar local.");
      }
    }
    setSaving(false);
  }

  function showToast(m){ setToast(m); setTimeout(()=>setToast(""),2400); }
  function updateData(nd){ setData(nd); saveData(nd); }

  // Ações de Login e Cadastro
  async function handleLogin(e) {
    if (e) e.preventDefault();
    setAuthError("");
    if (!authForm.email || !authForm.senha) {
      setAuthError("Preencha todos os campos.");
      return;
    }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, authForm.email, authForm.senha);
      showToast("Bem-vindo!");
    } catch (err) {
      console.error(err);
      if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        setAuthError("E-mail ou senha inválidos.");
      } else {
        setAuthError("Erro ao fazer login: " + err.message);
      }
    }
    setLoading(false);
  }

  async function handleRegister(e) {
    if (e) e.preventDefault();
    setAuthError("");
    if (!authForm.email || !authForm.senha) {
      setAuthError("Preencha todos os campos.");
      return;
    }
    if (authForm.senha.length < 6) {
      setAuthError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, authForm.email, authForm.senha);
      showToast("Cadastro concluído com sucesso!");
    } catch (err) {
      console.error(err);
      if (err.code === "auth/email-already-in-use") {
        setAuthError("Este e-mail já está em uso.");
      } else {
        setAuthError("Erro ao cadastrar: " + err.message);
      }
    }
    setLoading(false);
  }

  function handleLogout() {
    if (isModeOnline && auth) {
      signOut(auth).then(() => {
        showToast("Conexão encerrada.");
      });
    } else {
      // Limpa usuário simulado
      setUser(null);
      setIsModeOnline(false);
      showToast("Modo visitante encerrado.");
    }
  }

  // Ativação do Modo Local sem Firebase Configurado ou por Escolha
  function handleEnterLocalMode() {
    setUser({ email: "visitante@casal.com", uid: "visitante_local", isAnonymous: true });
    setIsModeOnline(false);
    // Configura o perfil baseado na seleção de quem está acessando
    const responsavelPadrao = authForm.quem || "Casal";
    setFormGasto(f => ({ ...f, responsavel: responsavelPadrao }));
    setFormEntrada(f => ({ ...f, quem: responsavelPadrao === "Casal" ? "Lucas" : responsavelPadrao }));
    showToast("Modo Local/Visitante ativado!");
  }

  // Categorias dinâmicas: padrão + extras salvas
  const categorias = [...CATEGORIAS_PADRAO, ...(data.categoriasExtras||[])].sort((a,b)=>a.localeCompare(b,"pt-BR"));

  function adicionarCategoria() {
    const nome = novaCategoria.trim();
    if (!nome) return;
    if (categorias.some(c=>c.toLowerCase()===nome.toLowerCase())) { showToast("Categoria já existe!"); return; }
    updateData({ ...data, categoriasExtras:[...(data.categoriasExtras||[]), nome] });
    setNovaCategoria("");
    showToast(`✓ Categoria "${nome}" adicionada!`);
  }
  function removerCategoria(nome) {
    updateData({ ...data, categoriasExtras:(data.categoriasExtras||[]).filter(c=>c!==nome) });
  }

  const filterTransactions = arr => {
    if (!arr) return [];
    if (tipoFiltro === "mensal") {
      return arr.filter(e => {
        const d = new Date(e.data + "T00:00:00");
        return d.getMonth() === filtroMes && d.getFullYear() === filtroAno;
      });
    } else {
      return arr.filter(e => e.data >= filtroDataInicio && e.data <= filtroDataFim);
    }
  };
  const applySearch = arr => search.trim() ? arr.filter(i=>[i.descricao,i.categoria||"",i.quem||"",i.responsavel||""].some(f=>f.toLowerCase().includes(search.toLowerCase()))) : arr;

  const entradasMes = filterTransactions(data.entradas || []);
  const gastosMes   = filterTransactions(data.gastos || []);
  const entradasFiltradas = applySearch(entradasMes);
  const gastosFiltrados   = applySearch(gastosMes.filter(g => {
    if (g.previsto && !g.efetivado) return gastosStatusFilter.previsto;
    if (g.previsto && g.efetivado) return gastosStatusFilter.efetivado;
    return gastosStatusFilter.consolidado;
  }));

  const efetivadas  = entradasMes.filter(e=>!e.previsto||e.efetivado);
  const efetivadosG = gastosMes.filter(g=>!g.previsto||g.efetivado);
  const totalEntradas = efetivadas.reduce((s,e)=>s+Number(e.valor),0);
  const totalGastos   = efetivadosG.reduce((s,g)=>s+Number(g.valor),0);
  const previstasE = entradasMes.filter(e=>e.previsto&&!e.efetivado).reduce((s,e)=>s+Number(e.valor),0);
  const previstosG = gastosMes.filter(g=>g.previsto&&!g.efetivado).reduce((s,g)=>s+Number(g.valor),0);
  const saldo = totalEntradas - totalGastos;

  const entradasLucas = efetivadas.filter(e=>e.quem==="Lucas").reduce((s,e)=>s+Number(e.valor),0);
  const entradasLene  = efetivadas.filter(e=>e.quem==="Lene").reduce((s,e)=>s+Number(e.valor),0);
  const gastosPorPessoa = {
    Casal: efetivadosG.filter(g=>g.responsavel==="Casal").reduce((s,g)=>s+Number(g.valor),0),
    Lucas: efetivadosG.filter(g=>g.responsavel==="Lucas").reduce((s,g)=>s+Number(g.valor),0),
    Lene:  efetivadosG.filter(g=>g.responsavel==="Lene").reduce((s,g)=>s+Number(g.valor),0),
  };
  const gastosPorCategoria = categorias.reduce((acc,cat)=>{ acc[cat]=efetivadosG.filter(g=>g.categoria===cat).reduce((s,g)=>s+Number(g.valor),0); return acc; },{});

  const limiteDataInicio = tipoFiltro === "mensal"
    ? `${filtroAno}-${String(filtroMes + 1).padStart(2, "0")}-01`
    : filtroDataInicio;

  const gastosPendentesAnteriores = (data.gastos || []).filter(g => g.previsto && !g.efetivado && g.data < limiteDataInicio);
  const totalPendentesAnteriores = gastosPendentesAnteriores.reduce((s, g) => s + Number(g.valor), 0);

  const mesLabel = tipoFiltro === "mensal" 
    ? `${MESES[filtroMes]}/${filtroAno}`
    : (() => {
        const formatarData = (dStr) => {
          if (!dStr) return "";
          const [a, m, d] = dStr.split("-");
          return `${d}/${m}/${a.slice(-2)}`;
        };
        return `${formatarData(filtroDataInicio)} a ${formatarData(filtroDataFim)}`;
      })();

  function addGasto(previsto) {
    if (!formGasto.descricao||!formGasto.valor) return;
    const subItens = detalharItensForm ? itensGastoForm : [];
    const parcelas = gerarParcelas(formGasto, previsto, subItens);
    updateData({ ...data, gastos:[...parcelas,...(data.gastos||[])] });
    setFormGasto({ ...formGasto, descricao:"", valor:"", totalParcelas:"1" });
    setDetalharItensForm(false);
    setItensGastoForm([]);
    setNovoItemDesc("");
    setNovoItemValor("");
  }
  function addEntrada(previsto) {
    if (!formEntrada.descricao||!formEntrada.valor) return;
    updateData({ ...data, entradas:[{ ...formEntrada, id:Date.now(), valor:parseFloat(formEntrada.valor), previsto:previsto||false, efetivado:false },...(data.entradas||[])] });
    setFormEntrada({ ...formEntrada, descricao:"", valor:"" });
  }

  function onImportarItens(novasTransacoes) {
    const novasEntradas = [];
    const novosGastos = [];
    
    novasTransacoes.forEach(t => {
      if (t.tipo === "entrada") {
        novasEntradas.push(t.dados);
      } else {
        novosGastos.push(t.dados);
      }
    });

    const novoData = {
      ...data,
      entradas: [...novasEntradas, ...(data.entradas || [])],
      gastos: [...novosGastos, ...(data.gastos || [])]
    };

    updateData(novoData);
  }

  function efetivar(tipo, item) {
    setEfetivandoItem({ tipo, item });
    setValorPagoForm(item.valor.toString());
  }

  function confirmarEfetivacao() {
    if (!efetivandoItem) return;
    const { tipo, item } = efetivandoItem;
    const valorPago = parseFloat(valorPagoForm);

    if (isNaN(valorPago) || valorPago <= 0) {
      showToast("Digite um valor válido maior que zero.");
      return;
    }

    if (valorPago > item.valor) {
      showToast(`O valor pago não pode ser maior que o total (R$ ${item.valor.toFixed(2)}).`);
      return;
    }

    if (valorPago === item.valor) {
      if (tipo === "entrada") {
        updateData({ ...data, entradas: data.entradas.map(e => e.id === item.id ? { ...e, efetivado: true } : e) });
      } else {
        updateData({ ...data, gastos: data.gastos.map(g => g.id === item.id ? { ...g, efetivado: true } : g) });
      }
      showToast("✓ Efetivado com sucesso!");
    } else {
      const nomeParcial = `${item.descricao} (Parcial)`;
      if (tipo === "entrada") {
        const itemRecebido = {
          ...item,
          id: Date.now(),
          descricao: nomeParcial,
          valor: valorPago,
          efetivado: true,
          previsto: false
        };
        const itemRestante = {
          ...item,
          valor: item.valor - valorPago
        };
        const novasEntradas = data.entradas.map(e => e.id === item.id ? itemRestante : e);
        novasEntradas.unshift(itemRecebido);
        updateData({ ...data, entradas: novasEntradas });
      } else {
        const itemPago = {
          ...item,
          id: Date.now(),
          descricao: nomeParcial,
          valor: valorPago,
          efetivado: true,
          previsto: false,
          itens: undefined
        };
        const itemRestante = {
          ...item,
          valor: item.valor - valorPago
        };
        const novosGastos = data.gastos.map(g => g.id === item.id ? itemRestante : g);
        novosGastos.unshift(itemPago);
        updateData({ ...data, gastos: novosGastos });
      }
      showToast(`✓ Pagamento parcial de ${fmt(valorPago)} registrado!`);
    }

    setEfetivandoItem(null);
  }

  function openEdit(tipo, item){ setEditItem({tipo,item}); setEditForm({...item}); }
  function saveEdit() {
    if (!editForm.descricao||!editForm.valor) return;
    const updated = { ...editForm, valor:parseFloat(editForm.valor) };
    if (editItem.tipo==="entrada") updateData({ ...data, entradas:data.entradas.map(e=>e.id===updated.id?updated:e) });
    else updateData({ ...data, gastos:data.gastos.map(g=>g.id===updated.id?updated:g) });
    setEditItem(null);
  }
  function askDelete(tipo,id,grupoId){ setDeleteScope("one"); setConfirmDelete({tipo,id,grupoId}); }
  function doDelete() {
    if (!confirmDelete) return;
    const {tipo,id,grupoId} = confirmDelete;
    let newGastos=data.gastos || [], newEntradas=data.entradas || [];
    if (tipo==="entrada") newEntradas=data.entradas.filter(e=>e.id!==id);
    else if (deleteScope==="all"&&grupoId) newGastos=data.gastos.filter(g=>g.grupoId!==grupoId);
    else newGastos=data.gastos.filter(g=>g.id!==id);
    updateData({ ...data, gastos:newGastos, entradas:newEntradas });
    setConfirmDelete(null);
  }
  function saveOrcamento(){ updateData({ ...data, orcamentos:{ ...(data.orcamentos||{}), ...orcEdit } }); }

  function exportarJSON() {
    triggerDownload(JSON.stringify(data,null,2), `financas_guerreiros_${new Date().toISOString().slice(0,10)}.json`, "application/json");
    showToast("✓ Backup baixado!");
  }
  function exportarCSV() {
    const linhas = ["Tipo,Descrição,Valor,Data,Categoria,Responsável/Quem,Parcela,Total Parcelas,Previsto,Efetivado"];
    (data.entradas || []).forEach(e=>linhas.push(`Entrada,"${e.descricao}",${e.valor},${e.data},,${e.quem||""},,,${e.previsto?"Sim":"Não"},${e.efetivado?"Sim":"Não"}`));
    (data.gastos || []).forEach(g=>linhas.push(`Gasto,"${g.descricao}",${g.valor},${g.data},${g.categoria||""},${g.responsavel||""},${g.parcela||1},${g.totalParcelas||1},${g.previsto?"Sim":"Não"},${g.efetivado?"Sim":"Não"}`));
    triggerDownload(linhas.join("\n"), `financas_guerreiros_${new Date().toISOString().slice(0,10)}.csv`, "text/csv");
    showToast("✓ CSV exportado!");
  }
  function lerArquivo(file) {
    if (!file) return;
    if (file.name.endsWith(".json")) lerJSON(file);
    else if (file.name.endsWith(".csv")) lerCSV(file);
    else showToast("Use arquivos .json ou .csv");
  }
  function lerJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { const d=JSON.parse(e.target.result); if(!d.entradas&&!d.gastos) throw new Error(); setBackupPreview({raw:d,entradas:d.entradas?.length??0,gastos:d.gastos?.length??0,tipo:"json"}); }
      catch { showToast("Arquivo JSON inválido."); }
    };
    reader.readAsText(file);
  }
  function lerCSV(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const linhas=ev.target.result.trim().split("\n").filter(Boolean);
        const cab=linhas[0].split(",").map(c=>c.trim().toLowerCase().replace(/[^a-z]/g,""));
        const idx=nome=>cab.findIndex(c=>c.includes(nome));
        const isTipo=idx("tipo"),isDesc=idx("desc"),isValor=idx("valor"),isData=idx("data"),isCat=idx("categ"),isQuem=idx("quem"),isResp=idx("respon"),isParcelas=idx("total");
        const entradas=[],gastos=[];let erros=0;
        linhas.slice(1).forEach((linha,li)=>{
          const cols=linha.match(/(".*?"|[^,]+)(?=,|$)/g)?.map(c=>c.replace(/^"|"$/g,"").trim())??linha.split(",").map(c=>c.trim());
          const tipo=(cols[isTipo]||"").toLowerCase(),valor=parseFloat((cols[isValor]||"0").replace(",",".")),dt=cols[isData]||"",desc=cols[isDesc]||"";
          if(!desc||isNaN(valor)||!dt){erros++;return;}
          let dataNorm=dt;
          if(/^\d{2}\/\d{2}\/\d{4}$/.test(dt)){const[d,m,a]=dt.split("/");dataNorm=`${a}-${m}-${d}`;}
          if(tipo==="entrada") entradas.push({id:Date.now()+li,descricao:desc,valor,data:dataNorm,quem:cols[isQuem]||"Lucas",previsto:false,efetivado:false});
          else if(tipo==="gasto"){
            const tot=parseInt(cols[isParcelas])||1,gId=tot>1?Date.now()+li*1000:undefined;
            const[ano,mes,dia]=dataNorm.split("-").map(Number);
            for(let p=0;p<tot;p++){const d=new Date(ano,mes-1+p,dia);const dp=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;gastos.push({id:Date.now()+li*1000+p, ...(gId ? { grupoId: gId } : {}), descricao:desc,valor,data:dp,categoria:cols[isCat]||"Outros",responsavel:cols[isResp]||"Casal",parcela:p+1,totalParcelas:tot,previsto:false,efetivado:false});}
          } else erros++;
        });
        setBackupPreview({raw:{entradas,gastos,orcamentos:data.orcamentos||{},categoriasExtras:data.categoriasExtras||[]},entradas:entradas.length,gastos:gastos.length,tipo:"csv",erros,merge:false});
      } catch { showToast("Erro ao ler o CSV."); }
    };
    reader.readAsText(file);
  }
  function restaurar() {
    const novoData = backupPreview.merge
      ? { entradas:[...(data.entradas||[]),...backupPreview.raw.entradas], gastos:[...(data.gastos||[]),...backupPreview.raw.gastos], orcamentos:{...(data.orcamentos||{}),...backupPreview.raw.orcamentos}, categoriasExtras:[...new Set([...(data.categoriasExtras||[]),...(backupPreview.raw.categoriasExtras||[])])] }
      : backupPreview.raw;
    updateData(novoData); setBackupPreview(null); setConfirmRestore(false); showToast("✓ Dados importados!");
  }

  const isUsuarioLucas = user && (
    (user.email && user.email.toLowerCase().includes("lucas")) ||
    (user.uid === "visitante_local" && (formGasto.responsavel === "Lucas" || authForm.quem === "Lucas"))
  );

  const tabs = [
    { key:"dashboard", label:"Painel",    icon:"📊" },
    { key:"entradas",  label:"Entradas",  icon:"📈" },
    { key:"gastos",    label:"Gastos",    icon:"📉" },
    ...(isUsuarioLucas ? [{ key:"extrato", label:"Extrato", icon:"📄" }] : []),
    { key:"orcamento", label:"Orçamento", icon:"🎯" },
    { key:"historico", label:"Histórico", icon:"🗂️" },
    { key:"backup",    label:"Backup",    icon:"💾" },
  ];

  // TELA DE CARREGAMENTO INICIAL
  if (authLoading) {
    return (
      <div style={{ minHeight:"100vh", background:CLR.neutral.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", color:CLR.neutral.label, gap:14 }}>
        <div style={{ fontSize: 32 }}>⚔️</div>
        <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: 0.5 }}>Carregando Finanças Guerreiros...</div>
      </div>
    );
  }

  // TELA DE LOGIN (Se não autenticado)
  if (!user) {
    return (
      <div style={{ minHeight:"100vh", background:CLR.neutral.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:16, fontFamily:"system-ui,sans-serif", boxSizing:"border-box" }}>
        <div style={{ width:"100%", maxWidth:400, background:CLR.neutral.card, border:`1px solid ${CLR.neutral.border}`, borderRadius:16, padding:"2rem", boxShadow:"0 8px 32px rgba(0,0,0,0.4)" }}>
          
          {/* Header do Login */}
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <div style={{ fontWeight:800, fontSize:26, marginBottom:6, background:"linear-gradient(90deg,#2ecc8f,#f0c040)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              ⚔️ Finanças Guerreiros
            </div>
            <div style={{ fontSize:12, color:CLR.neutral.muted }}>Gestão financeira conjunta de Lucas & Lene</div>
          </div>

          {/* Banner de Aviso de modo Offline se Firebase não estiver configurado */}
          {!isConfigured && (
            <div style={{ background: "#2a2110", border: "1px solid #6b5510", borderRadius: 8, padding: "10px 12px", marginBottom: 20 }}>
              <div style={{ color: "#d4b22a", fontSize: 12, fontWeight: 600, marginBottom: 2, display:"flex", alignItems:"center", gap: 5 }}>
                <span>⚠️</span> Modo Local de Demonstração
              </div>
              <div style={{ color: CLR.neutral.label, fontSize: 11, lineHeight: 1.3 }}>
                As chaves do Firebase não estão no arquivo <code>.env</code>. Seus dados serão gravados apenas neste navegador.
              </div>
            </div>
          )}

          {/* Formulário de Autenticação */}
          {isConfigured ? (
            <form onSubmit={isRegister ? handleRegister : handleLogin} style={{ display:"grid", gap:14 }}>
              <div style={{ fontSize:14, fontWeight:600, color:CLR.neutral.label, borderBottom:`1px solid ${CLR.neutral.border}`, paddingBottom:6, marginBottom:4 }}>
                {isRegister ? "Criar conta do Casal" : "Conectar-se Online"}
              </div>

              {authError && (
                <div style={{ background:`${CLR.gasto.bg}44`, color:CLR.gasto.text, border:`1px solid ${CLR.gasto.border}66`, borderRadius:8, padding:"8px 12px", fontSize:12, fontWeight:500 }}>
                  {authError}
                </div>
              )}

              <InputField 
                label="E-mail" 
                type="email" 
                placeholder="ex: lucas.lene@casal.com" 
                value={authForm.email} 
                onChange={e=>setAuthForm({...authForm, email:e.target.value})} 
                required 
              />

              <InputField 
                label="Senha" 
                type="password" 
                placeholder="******" 
                value={authForm.senha} 
                onChange={e=>setAuthForm({...authForm, senha:e.target.value})} 
                required 
              />

              {!isRegister && (
                <SelectField 
                  label="Quem está acessando preferencialmente?" 
                  value={authForm.quem} 
                  onChange={e=>setAuthForm({...authForm, quem:e.target.value})}
                >
                  <option value="Lucas">Lucas</option>
                  <option value="Lene">Lene</option>
                  <option value="Casal">Ambos (Casal)</option>
                </SelectField>
              )}

              <button type="submit" style={{ ...baseBtn, background:"linear-gradient(90deg,#0d3d2e,#1a6647)", color:CLR.entrada.text, border:`1px solid ${CLR.entrada.border}`, padding:"12px", fontSize:14, fontWeight:600, marginTop:6 }}>
                {loading ? "Carregando..." : isRegister ? "Registrar e Criar" : "✓ Entrar no Painel"}
              </button>

              <div style={{ display:"flex", justifyContent:"center", gap:6, fontSize:12, color:CLR.neutral.muted, marginTop:10 }}>
                <span>{isRegister ? "Já possui cadastro?" : "Primeira vez?"}</span>
                <button type="button" onClick={() => { setIsRegister(!isRegister); setAuthError(""); }} style={{ background:"none", border:"none", color:CLR.parcela.text, cursor:"pointer", fontWeight:600, padding:0 }}>
                  {isRegister ? "Fazer Login" : "Criar uma Conta"}
                </button>
              </div>

              {/* Botão de escape para rodar local mesmo com Firebase configurado */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr", borderTop:`1px solid ${CLR.neutral.border}`, marginTop:14, paddingTop:12 }}>
                <button type="button" onClick={handleEnterLocalMode} style={{ ...baseBtn, background:"#1a1a3d", color:"#7b8cde", border:"1px solid #3a3a7a", padding:"8px", fontSize:11 }}>
                  🚪 Acessar em Modo Local (Offline)
                </button>
              </div>
            </form>
          ) : (
            /* Formulário Simplificado sem Firebase Configurado */
            <div style={{ display:"grid", gap:14 }}>
              <SelectField 
                label="Quem é você?" 
                value={authForm.quem} 
                onChange={e=>setAuthForm({...authForm, quem:e.target.value})}
              >
                <option value="Lucas">Lucas</option>
                <option value="Lene">Lene</option>
                <option value="Casal">Casal</option>
              </SelectField>

              <button onClick={handleEnterLocalMode} style={{ ...baseBtn, background:"linear-gradient(90deg,#0d3d2e,#1a6647)", color:CLR.entrada.text, border:`1px solid ${CLR.entrada.border}`, padding:"12px", fontSize:14, fontWeight:600, marginTop:10 }}>
                🚀 Entrar em Modo Local (Demonstração)
              </button>
              
              <div style={{ fontSize:11, color:CLR.neutral.muted, textAlign:"center", marginTop:10, lineHeight:1.3 }}>
                Você poderá usar todos os recursos de planejamento, parcelas e backups locais. Para salvar na nuvem em tempo real, preencha as variáveis do Firebase no seu arquivo <code>.env</code> e reinicie o servidor.
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // EXIBIÇÃO DO APP PRINCIPAL CARREGANDO DADOS DO FIRESTORE/LOCALSTORAGE
  if (loading) {
    return (
      <div style={{ minHeight:"100vh", background:CLR.neutral.bg, display:"flex", alignItems:"center", justifyContent:"center", color:CLR.neutral.label }}>
        Carregando informações financeiras...
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:CLR.neutral.bg, color:"#e2e8f0", fontFamily:"system-ui,sans-serif" }}>

      {toast && <div style={{ position:"fixed", top:16, right:16, background:"#1a4a38", border:`1px solid ${CLR.entrada.border}`, color:CLR.entrada.text, borderRadius:10, padding:"10px 18px", fontWeight:500, fontSize:13, zIndex:999 }}>{toast}</div>}

      {/* Modal editar */}
      {editItem && (
        <Modal title={editItem.tipo==="entrada"?"✏️ Editar Entrada":"✏️ Editar Gasto"} accent={editItem.tipo==="entrada"?"entrada":"gasto"} onClose={()=>setEditItem(null)}>
          <div style={{ display:"grid", gap:10 }}>
            <InputField label="Descrição" value={editForm.descricao} onChange={e=>setEditForm({...editForm,descricao:e.target.value})} />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              <InputField label="Valor (R$)" type="number" value={editForm.valor} onChange={e=>setEditForm({...editForm,valor:e.target.value})} disabled={editForm.itens && editForm.itens.length > 0} />
              <InputField label="Data" type="date" value={editForm.data} onChange={e=>setEditForm({...editForm,data:e.target.value})} />
            </div>
            {editItem.tipo==="entrada"
              ? <SelectField label="Quem recebeu" value={editForm.quem} onChange={e=>setEditForm({...editForm,quem:e.target.value})}><option>Lucas</option><option>Lene</option></SelectField>
              : <>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    <SelectField label="Categoria" value={editForm.categoria} onChange={e=>setEditForm({...editForm,categoria:e.target.value})}>{categorias.map(c=><option key={c}>{c}</option>)}</SelectField>
                    <SelectField label="Responsável" value={editForm.responsavel} onChange={e=>setEditForm({...editForm,responsavel:e.target.value})}>{RESPONSAVEIS.map(r=><option key={r}>{r}</option>)}</SelectField>
                  </div>
                  
                  {/* Detalhamento de sub-itens dentro do modal de edição */}
                  <div style={{ 
                    background: "#1c1c2b", 
                    border: `1px solid ${CLR.neutral.border}`, 
                    borderRadius: 10, 
                    padding: 12, 
                    display: "grid", 
                    gap: 10,
                    marginTop: 4
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: CLR.parcela.text, display: "flex", justifyContent: "space-between" }}>
                      <span>📋 Itens Detalhados</span>
                      <span>Total: {fmt((editForm.itens || []).reduce((s,i)=>s+Number(i.valor),0))}</span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 90px auto", gap: 6, alignItems: "end" }}>
                      <InputField 
                        label="Nome do Item" 
                        placeholder="Ex: Prato, Cortina..." 
                        value={editNovoItemDesc} 
                        onChange={e=>setEditNovoItemDesc(e.target.value)} 
                      />
                      <InputField 
                        label="Valor (R$)" 
                        type="number" 
                        placeholder="0,00" 
                        value={editNovoItemValor} 
                        onChange={e=>setEditNovoItemValor(e.target.value)} 
                      />
                      <button 
                        type="button" 
                        onClick={() => {
                          if (!editNovoItemDesc || !editNovoItemValor) return;
                          const novoItem = {
                            id: Date.now(),
                            descricao: editNovoItemDesc,
                            valor: parseFloat(editNovoItemValor)
                          };
                          const itensAtuais = editForm.itens || [];
                          const novaLista = [...itensAtuais, novoItem];
                          const total = novaLista.reduce((s,i) => s + i.valor, 0);
                          setEditForm({
                            ...editForm,
                            itens: novaLista,
                            valor: total.toString()
                          });
                          setEditNovoItemDesc("");
                          setEditNovoItemValor("");
                        }}
                        style={{ ...baseBtn, background: CLR.entrada.bg, color: CLR.entrada.text, border: `1px solid ${CLR.entrada.border}`, height: 35, display: "flex", alignItems: "center", justifyContent: "center" }}
                      >
                        ➕
                      </button>
                    </div>

                    {(editForm.itens || []).length > 0 && (
                      <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
                        {editForm.itens.map((it) => (
                          <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: CLR.neutral.card, border: `1px solid ${CLR.neutral.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                            <span style={{ color: "#e2e8f0" }}>• {it.descricao}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontWeight: 600, color: CLR.entrada.text }}>{fmt(it.valor)}</span>
                              <button 
                                type="button" 
                                onClick={() => {
                                  const novaLista = editForm.itens.filter(i => i.id !== it.id);
                                  const total = novaLista.reduce((s,i) => s + i.valor, 0);
                                  setEditForm({
                                    ...editForm,
                                    itens: novaLista,
                                    valor: total.toString()
                                  });
                                }} 
                                style={{ background: "none", border: "none", color: CLR.gasto.text, cursor: "pointer", padding: "2px 4px", fontSize: 11 }}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>}
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:CLR.neutral.bg, borderRadius:8, border:`1px solid ${CLR.neutral.border}` }}>
              <input type="checkbox" id="editPrevisto" checked={!!editForm.previsto} onChange={e=>setEditForm({...editForm,previsto:e.target.checked,efetivado:e.target.checked?editForm.efetivado:false})} />
              <label htmlFor="editPrevisto" style={{ fontSize:13, color:CLR.neutral.label, cursor:"pointer" }}>Item previsto (ainda não realizado)</label>
            </div>
            {editForm.previsto && (
              <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:CLR.neutral.bg, borderRadius:8, border:`1px solid ${CLR.neutral.border}` }}>
                <input type="checkbox" id="editEfetivado" checked={!!editForm.efetivado} onChange={e=>setEditForm({...editForm,efetivado:e.target.checked})} />
                <label htmlFor="editEfetivado" style={{ fontSize:13, color:CLR.neutral.label, cursor:"pointer" }}>Já efetivado</label>
              </div>
            )}
            <div style={{ display:"flex", gap:8, marginTop:6 }}>
              <button onClick={()=>setEditItem(null)} style={{ ...baseBtn, flex:1, background:CLR.neutral.card, color:"#e2e8f0", border:`1px solid ${CLR.neutral.border}` }}>Cancelar</button>
              <button onClick={saveEdit} style={{ ...baseBtn, flex:1, background:editItem.tipo==="entrada"?CLR.entrada.bg:CLR.gasto.bg, color:editItem.tipo==="entrada"?CLR.entrada.text:CLR.gasto.text, border:`1px solid ${editItem.tipo==="entrada"?CLR.entrada.border:CLR.gasto.border}` }}>Salvar</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Efetivação / Pagamento Parcial */}
      {efetivandoItem && (
        <Modal 
          title={efetivandoItem.tipo === "entrada" ? "✓ Confirmar Recebimento" : "✓ Confirmar Pagamento"} 
          accent={efetivandoItem.tipo === "entrada" ? "entrada" : "gasto"} 
          onClose={() => setEfetivandoItem(null)}
        >
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <div style={{ fontSize: 13, color: CLR.neutral.label, marginBottom: 4 }}>CONTA / LANÇAMENTO</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0" }}>{efetivandoItem.item.descricao}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: CLR.neutral.muted, marginBottom: 4 }}>VALOR TOTAL</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: CLR.neutral.label, background: CLR.neutral.bg, border: `1px solid ${CLR.neutral.border}`, borderRadius: 8, padding: "8px 12px" }}>
                  {fmt(efetivandoItem.item.valor)}
                </div>
              </div>
              <div>
                <InputField 
                  label="VALOR PAGO (R$)" 
                  type="number" 
                  placeholder="0,00" 
                  value={valorPagoForm} 
                  onChange={e => setValorPagoForm(e.target.value)} 
                />
              </div>
            </div>

            {parseFloat(valorPagoForm) < efetivandoItem.item.valor && parseFloat(valorPagoForm) > 0 && (
              <div style={{ 
                background: "rgba(212,194,42,0.1)", 
                border: `1px solid ${CLR.prevista.border}`, 
                borderRadius: 10, 
                padding: "10px 14px", 
                fontSize: 12,
                color: CLR.prevista.text,
                lineHeight: 1.4
              }}>
                <strong>⚠️ Pagamento Parcial Detectado:</strong><br />
                • Valor Efetivado (Pago): <strong>{fmt(parseFloat(valorPagoForm))}</strong><br />
                • Saldo Restante (Pendente): <strong>{fmt(efetivandoItem.item.valor - parseFloat(valorPagoForm))}</strong> (continuará listado como previsto)
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button 
                onClick={() => setEfetivandoItem(null)} 
                style={{ ...baseBtn, flex: 1, background: CLR.neutral.card, color: "#e2e8f0", border: `1px solid ${CLR.neutral.border}` }}
              >
                Cancelar
              </button>
              <button 
                onClick={confirmarEfetivacao} 
                style={{ 
                  ...baseBtn, 
                  flex: 1, 
                  background: efetivandoItem.tipo === "entrada" ? CLR.entrada.bg : CLR.gasto.bg, 
                  color: efetivandoItem.tipo === "entrada" ? CLR.entrada.text : CLR.gasto.text, 
                  border: `1px solid ${efetivandoItem.tipo === "entrada" ? CLR.entrada.border : CLR.gasto.border}`,
                  fontWeight: 700
                }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirmar exclusão */}
      {confirmDelete && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:CLR.neutral.bg, border:`1px solid ${CLR.gasto.border}`, borderRadius:16, padding:"1.5rem", width:"100%", maxWidth:340 }}>
            <div style={{ fontSize:14, marginBottom:16, color:"#e2e8f0", fontWeight:500 }}>Excluir item</div>
            {confirmDelete.grupoId && (
              <div style={{ marginBottom:16 }}>
                <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#e2e8f0", marginBottom:8, cursor:"pointer" }}><input type="radio" checked={deleteScope==="one"} onChange={()=>setDeleteScope("one")} /> Excluir apenas esta parcela</label>
                <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#e2e8f0", cursor:"pointer" }}><input type="radio" checked={deleteScope==="all"} onChange={()=>setDeleteScope("all")} /> Excluir todas as parcelas</label>
              </div>
            )}
            {!confirmDelete.grupoId && <div style={{ fontSize:13, color:CLR.neutral.muted, marginBottom:16 }}>Esta ação não pode ser desfeita.</div>}
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setConfirmDelete(null)} style={{ ...baseBtn, flex:1, background:CLR.neutral.card, color:"#e2e8f0", border:`1px solid ${CLR.neutral.border}` }}>Cancelar</button>
              <button onClick={doDelete} style={{ ...baseBtn, flex:1, background:CLR.gasto.bg, color:CLR.gasto.text, border:`1px solid ${CLR.gasto.border}` }}>Excluir</button>
            </div>
          </div>
        </div>
      )}

      {/* Banner Superior se estiver em Modo Local/Offline */}
      {!isModeOnline && (
        <div style={{ background:"#2a2010", borderBottom:"1px solid #6b5510", padding:"8px 1.25rem", display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:11, color:"#d4b22a", fontWeight:500 }}>
            ⚠️ Modo Offline/Local ativo. Seus dados estão sendo guardados apenas neste navegador.
          </span>
          {isConfigured && (
            <button onClick={handleLogout} style={{ ...baseBtn, background:"#1e1e2e", color:"#e2e8f0", border:"1px solid #333355", padding:"4px 10px", fontSize:10 }}>
              Reconectar Online
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <div style={{ padding:"1.25rem 1.25rem 1rem", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:`1px solid ${CLR.neutral.border}` }}>
        <div>
          <div style={{ fontWeight:700, fontSize:20, background:"linear-gradient(90deg,#2ecc8f,#f0c040)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>⚔️ Finanças Guerreiros</div>
          <div style={{ fontSize:12, color:CLR.neutral.muted }}>
            Lucas & Lene — {isModeOnline ? <span style={{ color:"#2ecc8f", fontWeight:600 }}>Sincronizado Online 🔥</span> : "Modo Local 💾"}
          </div>
        </div>
        
        <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          {saving && <span style={{ fontSize:11, color:CLR.neutral.muted }}>💾 Salvando...</span>}
          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
            <select value={tipoFiltro} onChange={e=>setTipoFiltro(e.target.value)} style={{ ...baseInput, width:"auto", padding:"6px 10px", fontSize:12 }}>
              <option value="mensal">Mensal</option>
              <option value="periodo">Período</option>
            </select>
            
            {tipoFiltro === "mensal" ? (
              <div style={{ display:"flex", gap:4 }}>
                <select value={filtroMes} onChange={e=>setFiltroMes(Number(e.target.value))} style={{ ...baseInput, width:"auto", padding:"6px 10px", fontSize:12 }}>
                  {MESES.map((m,i)=><option key={i} value={i}>{m}</option>)}
                </select>
                <select value={filtroAno} onChange={e=>setFiltroAno(Number(e.target.value))} style={{ ...baseInput, width:"auto", padding:"6px 10px", fontSize:12 }}>
                  {[2024,2025,2026,2027].map(a=><option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <input type="date" value={filtroDataInicio} onChange={e=>setFiltroDataInicio(e.target.value)} style={{ ...baseInput, width:"auto", padding:"5px 8px", fontSize:12 }} />
                <span style={{ fontSize:11, color:CLR.neutral.muted }}>até</span>
                <input type="date" value={filtroDataFim} onChange={e=>setFiltroDataFim(e.target.value)} style={{ ...baseInput, width:"auto", padding:"5px 8px", fontSize:12 }} />
              </div>
            )}
          </div>
          
          {/* Botão de Logout */}
          <button onClick={handleLogout} title="Sair do aplicativo" style={{ ...baseBtn, background:"#3d1515", color:"#e05555", border:"1px solid #6b2525", padding:"6px 10px", display:"flex", alignItems:"center", gap:4, fontSize:11 }}>
            🚪 Sair
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", padding:"0 1.25rem", borderBottom:`1px solid ${CLR.neutral.border}`, overflowX:"auto" }}>
        {tabs.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)} style={{ background:"none", border:"none", cursor:"pointer", padding:"12px 14px", fontSize:13, fontWeight:tab===t.key?600:400, color:tab===t.key?"#e2e8f0":CLR.neutral.muted, borderBottom:tab===t.key?"2px solid #f0c040":"2px solid transparent", marginBottom:-1, whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:5 }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding:"1.25rem" }}>

        {/* Alerta de Despesas Pendentes de Meses Anteriores */}
        {gastosPendentesAnteriores.length > 0 && (
          <div style={{
            background: "#2a1e12",
            border: "1px solid #7c4a15",
            borderRadius: 12,
            padding: "12px 16px",
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <div style={{ fontSize: 13, color: "#ffb055", fontWeight: 500 }}>
                Atenção: Você tem <strong>{gastosPendentesAnteriores.length} despesa(s) prevista(s) pendente(s)</strong> de meses passados (Total: <strong>{fmt(totalPendentesAnteriores)}</strong>)
              </div>
            </div>
            <button
              onClick={() => setVerPendenciasAnteriores(true)}
              style={{ ...baseBtn, background: "#5c330a", color: "#ffaa44", border: "1px solid #7c4a15", padding: "6px 12px", fontSize: 12, fontWeight: 600 }}
            >
              🔍 Resolver Pendências
            </button>
          </div>
        )}

        {/* Modal para Visualizar e Resolver Pendências Anteriores */}
        {verPendenciasAnteriores && (
          <Modal 
            title="⚠️ Despesas Pendentes de Meses Anteriores" 
            accent="prevista" 
            onClose={() => setVerPendenciasAnteriores(false)}
          >
            <div style={{ fontSize: 12, color: CLR.neutral.muted, marginBottom: 14, lineHeight: 1.4 }}>
              As seguintes despesas foram previstas para datas anteriores ao período atual, mas ainda não foram efetivadas. Resolva-as abaixo:
            </div>
            <div style={{ maxHeight: "45vh", overflowY: "auto", display: "grid", gap: 4, paddingRight: 4 }}>
              {gastosPendentesAnteriores.map(g => (
                <ItemRow 
                  key={g.id} 
                  item={g} 
                  tipo="gasto" 
                  onEdit={(tipo, item) => {
                    setVerPendenciasAnteriores(false); // Fecha este modal para abrir o de edição
                    openEdit(tipo, item);
                  }} 
                  onDelete={askDelete} 
                  onEfetivar={efetivar} 
                />
              ))}
            </div>
            <button 
              onClick={() => setVerPendenciasAnteriores(false)} 
              style={{ ...baseBtn, background: CLR.neutral.card, color: "#e2e8f0", border: `1px solid ${CLR.neutral.border}`, width: "100%", marginTop: 14 }}
            >
              Fechar
            </button>
          </Modal>
        )}

        {/* DASHBOARD */}
        {tab==="dashboard" && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginBottom:18 }}>
              <StatCard label="Entradas efetivadas" value={fmt(totalEntradas)} icon="📈" color={CLR.entrada.text} sub={`${efetivadas.length} registro(s)`} />
              <StatCard label="Gastos efetivados"   value={fmt(totalGastos)}   icon="📉" color={CLR.gasto.text}   sub={`${efetivadosG.length} registro(s)`} />
              <StatCard label="Saldo do mês"         value={fmt(saldo)}         icon="💰" color={saldo>=0?CLR.entrada.text:CLR.gasto.text} sub={mesLabel} />
              {previstasE>0 && <StatCard label="Prev. entradas" value={fmt(previstasE)} icon="🔮" color={CLR.prevista.text} sub="Ainda não efetivado" />}
              {previstosG>0 && <StatCard label="Prev. gastos"   value={fmt(previstosG)} icon="🔮" color={CLR.prevista.text} sub="Ainda não efetivado" />}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:18 }}>
              <Card>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:12, color:CLR.entrada.text }}>📈 Entradas por pessoa</div>
                {[{label:"Lucas",val:entradasLucas},{label:"Lene",val:entradasLene}].map(p=>(
                  <div key={p.label} style={{ marginBottom:10 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:4 }}>
                      <span style={{ color:CLR.neutral.label }}>{p.label}</span>
                      <span style={{ fontWeight:600, color:CLR.entrada.text }}>{fmt(p.val)}</span>
                    </div>
                    <ProgressBar val={p.val} max={totalEntradas} />
                  </div>
                ))}
              </Card>
              <Card>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:12, color:CLR.gasto.text }}>📉 Gastos por responsável</div>
                {Object.entries(gastosPorPessoa).map(([k,v])=>(
                  <div key={k} style={{ marginBottom:10 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:4 }}>
                      <span style={{ color:CLR.neutral.label }}>{k}</span>
                      <span style={{ fontWeight:600, color:CLR.gasto.text }}>{fmt(v)}</span>
                    </div>
                    <ProgressBar val={v} max={totalGastos} />
                  </div>
                ))}
              </Card>
            </div>
            <Card>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:14, color:"#f0c040" }}>🎯 Gastos vs. Orçamento por categoria</div>
              {categorias.filter(c=>gastosPorCategoria[c]>0).map(cat=>{
                const orc=(data.orcamentos || {})[cat]||0, gasto=gastosPorCategoria[cat];
                return (
                  <div key={cat} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:4 }}>
                      <span style={{ color:CLR.neutral.label }}>{cat}</span>
                      <span style={{ fontWeight:600, color:CLR.gasto.text }}>{fmt(gasto)}{orc>0&&<span style={{ color:CLR.neutral.muted, fontWeight:400 }}> / {fmt(orc)}</span>}</span>
                    </div>
                    {orc>0&&<ProgressBar val={gasto} max={orc} />}
                  </div>
                );
              })}
              {categorias.every(c=>gastosPorCategoria[c]===0)&&<div style={{ fontSize:13, color:CLR.neutral.muted }}>Nenhum gasto efetivado neste mês.</div>}
            </Card>
          </div>
        )}

        {/* ENTRADAS */}
        {tab==="entradas" && (
          <div>
            <Card style={{ marginBottom:18, border:`1px solid ${CLR.entrada.border}` }}>
              <div style={{ fontSize:14, fontWeight:600, marginBottom:14, color:CLR.entrada.text }}>📈 Adicionar entrada</div>
              <div style={{ display:"grid", gap:10 }}>
                <InputField label="Descrição" placeholder="Ex: Salário, Freela..." value={formEntrada.descricao} onChange={e=>setFormEntrada({...formEntrada,descricao:e.target.value})} />
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                  <InputField label="Valor (R$)" type="number" placeholder="0,00" value={formEntrada.valor} onChange={e=>setFormEntrada({...formEntrada,valor:e.target.value})} />
                  <SelectField label="Quem recebeu" value={formEntrada.quem} onChange={e=>setFormEntrada({...formEntrada,quem:e.target.value})}><option>Lucas</option><option>Lene</option></SelectField>
                  <InputField label="Data" type="date" value={formEntrada.data} onChange={e=>setFormEntrada({...formEntrada,data:e.target.value})} />
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  <button onClick={()=>addEntrada(false)} style={{ ...baseBtn, background:CLR.entrada.bg, color:CLR.entrada.text, border:`1px solid ${CLR.entrada.border}`, padding:"10px" }}>+ Adicionar entrada</button>
                  <button onClick={()=>addEntrada(true)}  style={{ ...baseBtn, background:CLR.prevista.bg, color:CLR.prevista.text, border:`1px solid ${CLR.prevista.border}`, padding:"10px" }}>🔮 Lançar como previsto</button>
                </div>
              </div>
            </Card>
            <SearchBar value={search} onChange={setSearch} />
            <div style={{ fontSize:12, color:CLR.neutral.muted, marginBottom:10 }}>
              {mesLabel} — {entradasFiltradas.length} entrada(s) — Efetivado: <span style={{ color:CLR.entrada.text, fontWeight:600 }}>{fmt(totalEntradas)}</span>
              {previstasE>0&&<> — Previsto: <span style={{ color:CLR.prevista.text, fontWeight:600 }}>{fmt(previstasE)}</span></>}
            </div>
            {entradasFiltradas.length===0&&<div style={{ fontSize:13, color:CLR.neutral.muted, textAlign:"center", padding:"2rem 0" }}>Nenhuma entrada encontrada.</div>}
            {entradasFiltradas.map(e=><ItemRow key={e.id} item={e} tipo="entrada" onEdit={openEdit} onDelete={askDelete} onEfetivar={efetivar} />)}
          </div>
        )}

        {/* GASTOS */}
        {tab==="gastos" && (
          <div>
            <Card style={{ marginBottom:18, border:`1px solid ${CLR.gasto.border}` }}>
              <div style={{ fontSize:14, fontWeight:600, marginBottom:14, color:CLR.gasto.text }}>📉 Adicionar gasto</div>
              <div style={{ display:"grid", gap:10 }}>
                <InputField label="Descrição" placeholder="Ex: Fatura Cartão, Netflix..." value={formGasto.descricao} onChange={e=>setFormGasto({...formGasto,descricao:e.target.value})} />
                
                {/* Botão para ativar detalhamento de sub-itens */}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -4 }}>
                  <button 
                    type="button" 
                    onClick={() => {
                      const novoEstado = !detalharItensForm;
                      setDetalharItensForm(novoEstado);
                      if (!novoEstado) {
                        setItensGastoForm([]);
                      }
                    }} 
                    style={{ 
                      ...baseBtn, 
                      background: detalharItensForm ? "rgba(224,85,85,0.1)" : "rgba(123,140,222,0.1)", 
                      color: detalharItensForm ? CLR.gasto.text : CLR.parcela.text, 
                      border: `1px solid ${detalharItensForm ? CLR.gasto.border : CLR.parcela.border}`, 
                      fontSize: 11,
                      padding: "4px 10px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4
                    }}
                  >
                    {detalharItensForm ? "✕ Cancelar detalhamento" : "📋 Detalhar itens desta compra"}
                  </button>
                </div>

                {/* Área dinâmica de detalhamento de sub-itens */}
                {detalharItensForm && (
                  <div style={{ 
                    background: "#1c1c2b", 
                    border: `1px solid ${CLR.neutral.border}`, 
                    borderRadius: 10, 
                    padding: 12,
                    display: "grid",
                    gap: 10 
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: CLR.parcela.text, display: "flex", justifyContent: "space-between" }}>
                      <span>📋 Itens da Compra</span>
                      <span>Total: {fmt(itensGastoForm.reduce((s,i)=>s+Number(i.valor),0))}</span>
                    </div>
                    
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 90px auto", gap: 6, alignItems: "end" }}>
                      <InputField 
                        label="Nome do Item" 
                        placeholder="Ex: Prato, Cortina..." 
                        value={novoItemDesc} 
                        onChange={e=>setNovoItemDesc(e.target.value)} 
                      />
                      <InputField 
                        label="Valor (R$)" 
                        type="number" 
                        placeholder="0,00" 
                        value={novoItemValor} 
                        onChange={e=>setNovoItemValor(e.target.value)} 
                      />
                      <button 
                        type="button" 
                        onClick={() => {
                          if (!novoItemDesc || !novoItemValor) return;
                          const novoItem = {
                            id: Date.now(),
                            descricao: novoItemDesc,
                            valor: parseFloat(novoItemValor)
                          };
                          const novaLista = [...itensGastoForm, novoItem];
                          setItensGastoForm(novaLista);
                          setNovoItemDesc("");
                          setNovoItemValor("");
                          // Atualiza o valor total no formGasto
                          const total = novaLista.reduce((s,i) => s + i.valor, 0);
                          setFormGasto(f => ({ ...f, valor: total.toString() }));
                        }}
                        style={{ ...baseBtn, background: CLR.entrada.bg, color: CLR.entrada.text, border: `1px solid ${CLR.entrada.border}`, height: 35, display: "flex", alignItems: "center", justifyContent: "center" }}
                      >
                        ➕
                      </button>
                    </div>

                    {itensGastoForm.length > 0 && (
                      <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
                        {itensGastoForm.map((it) => (
                          <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: CLR.neutral.card, border: `1px solid ${CLR.neutral.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12 }}>
                            <span style={{ color: "#e2e8f0" }}>• {it.descricao}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontWeight: 600, color: CLR.entrada.text }}>{fmt(it.valor)}</span>
                              <button 
                                type="button" 
                                onClick={() => {
                                  const novaLista = itensGastoForm.filter(i => i.id !== it.id);
                                  setItensGastoForm(novaLista);
                                  const total = novaLista.reduce((s,i) => s + i.valor, 0);
                                  setFormGasto(f => ({ ...f, valor: total.toString() }));
                                }} 
                                style={{ background: "none", border: "none", color: CLR.gasto.text, cursor: "pointer", padding: "2px 4px", fontSize: 11 }}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  <InputField label="Valor por parcela (R$)" type="number" placeholder="0,00" value={formGasto.valor} onChange={e=>setFormGasto({...formGasto,valor:e.target.value})} disabled={detalharItensForm} />
                  <InputField label="Data da 1ª parcela" type="date" value={formGasto.data} onChange={e=>setFormGasto({...formGasto,data:e.target.value})} />
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                  <SelectField label="Categoria" value={formGasto.categoria} onChange={e=>setFormGasto({...formGasto,categoria:e.target.value})}>
                    {categorias.map(c=><option key={c}>{c}</option>)}
                  </SelectField>
                  <SelectField label="Responsável" value={formGasto.responsavel} onChange={e=>setFormGasto({...formGasto,responsavel:e.target.value})}>
                    {RESPONSAVEIS.map(r=><option key={r}>{r}</option>)}
                  </SelectField>
                  <div>
                    <div style={{ fontSize:11, color:CLR.neutral.muted, marginBottom:4, fontWeight:500, letterSpacing:0.5, textTransform:"uppercase" }}>Nº de parcelas</div>
                    <input type="number" min="1" max="60" style={{ ...baseInput, borderColor:parseInt(formGasto.totalParcelas)>1?CLR.parcela.border:CLR.neutral.border }} value={formGasto.totalParcelas} onChange={e=>setFormGasto({...formGasto,totalParcelas:e.target.value})} />
                  </div>
                </div>
                {parseInt(formGasto.totalParcelas)>1&&formGasto.valor&&(
                  <div style={{ background:CLR.parcela.bg, border:`1px solid ${CLR.parcela.border}`, borderRadius:10, padding:"10px 14px", fontSize:12 }}>
                    <div style={{ color:CLR.parcela.text, fontWeight:600, marginBottom:4 }}>💳 Resumo das parcelas</div>
                    <div style={{ color:CLR.neutral.label, display:"flex", gap:16, flexWrap:"wrap" }}>
                      <span>{formGasto.totalParcelas}× de {fmt(formGasto.valor)}</span>
                      <span>Total: <strong style={{ color:"#e2e8f0" }}>{fmt(parseFloat(formGasto.valor)*parseInt(formGasto.totalParcelas))}</strong></span>
                    </div>
                  </div>
                )}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  <button onClick={()=>addGasto(false)} style={{ ...baseBtn, background:parseInt(formGasto.totalParcelas)>1?CLR.parcela.bg:CLR.gasto.bg, color:parseInt(formGasto.totalParcelas)>1?CLR.parcela.text:CLR.gasto.text, border:`1px solid ${parseInt(formGasto.totalParcelas)>1?CLR.parcela.border:CLR.gasto.border}`, padding:"10px" }}>
                    {parseInt(formGasto.totalParcelas)>1?`💳 Lançar ${formGasto.totalParcelas} parcelas`:"+ Adicionar gasto"}
                  </button>
                  <button onClick={()=>addGasto(true)} style={{ ...baseBtn, background:CLR.prevista.bg, color:CLR.prevista.text, border:`1px solid ${CLR.prevista.border}`, padding:"10px" }}>🔮 Lançar como previsto</button>
                </div>
              </div>
            </Card>
            <div style={{ display:"grid", gap:10, marginBottom:10 }}>
              <SearchBar value={search} onChange={setSearch} />
              <div style={{ display:"grid", gap:8 }}>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, alignItems:"center", justifyContent:"space-between" }}>
                  <div style={{ fontSize:12, color:CLR.neutral.muted }}>
                    {mesLabel} — {gastosFiltrados.length} gasto(s) — Efetivado: <span style={{ color:CLR.gasto.text, fontWeight:600 }}>{fmt(totalGastos)}</span>
                    {previstosG>0&&<> — Previsto: <span style={{ color:CLR.prevista.text, fontWeight:600 }}>{fmt(previstosG)}</span></>}
                  </div>
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:12, alignItems:"center" }}>
                  <span style={{ fontSize:11, color:CLR.neutral.muted, textTransform:"uppercase", letterSpacing:0.5 }}>Filtrar</span>
                  <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:CLR.neutral.label }}>
                    <input type="checkbox" checked={gastosStatusFilter.previsto} onChange={e=>setGastosStatusFilter(s=>({...s, previsto:e.target.checked}))} />
                    Previsto não efetivado
                  </label>
                  <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:CLR.neutral.label }}>
                    <input type="checkbox" checked={gastosStatusFilter.efetivado} onChange={e=>setGastosStatusFilter(s=>({...s, efetivado:e.target.checked}))} />
                    Efetivado
                  </label>
                  <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:CLR.neutral.label }}>
                    <input type="checkbox" checked={gastosStatusFilter.consolidado} onChange={e=>setGastosStatusFilter(s=>({...s, consolidado:e.target.checked}))} />
                    Consolidado direto
                  </label>
                </div>
              </div>
            </div>
            {gastosFiltrados.length===0&&<div style={{ fontSize:13, color:CLR.neutral.muted, textAlign:"center", padding:"2rem 0" }}>Nenhum gasto encontrado.</div>}
            {gastosFiltrados.map(g=><ItemRow key={g.id} item={g} tipo="gasto" onEdit={openEdit} onDelete={askDelete} onEfetivar={efetivar} />)}
          </div>
        )}

        {/* ORÇAMENTO */}
        {tab==="orcamento" && (
          <div>
            <Card style={{ marginBottom:16, border:"1px solid #3a3a7a" }}>
              <div style={{ fontSize:14, fontWeight:600, color:"#7b8cde", marginBottom:10 }}>🏷️ Gerenciar categorias</div>
              <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                <input style={baseInput} placeholder="Nome da nova categoria..." value={novaCategoria} onChange={e=>setNovaCategoria(e.target.value)} onKeyDown={e=>e.key==="Enter"&&adicionarCategoria()} />
                <button onClick={adicionarCategoria} style={{ ...baseBtn, background:"#1a1a3d", color:"#7b8cde", border:"1px solid #3a3a7a", whiteSpace:"nowrap" }}>+ Adicionar</button>
              </div>
              {(data.categoriasExtras||[]).length>0 ? (
                <div>
                  <div style={{ fontSize:11, color:CLR.neutral.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:0.5 }}>Categorias criadas por você</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {[...(data.categoriasExtras||[])].sort((a,b)=>a.localeCompare(b,"pt-BR")).map(cat=>(
                      <div key={cat} style={{ display:"flex", alignItems:"center", gap:6, background:"#1a1a3d", border:"1px solid #3a3a7a", borderRadius:99, padding:"4px 10px 4px 12px" }}>
                        <span style={{ fontSize:13, color:"#e2e8f0" }}>{cat}</span>
                        <button onClick={()=>removerCategoria(cat)} style={{ ...baseBtn, background:"none", color:CLR.gasto.text, padding:"0 2px", fontSize:16, lineHeight:1 }}>×</button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <div style={{ fontSize:12, color:CLR.neutral.muted }}>Nenhuma categoria extra criada ainda.</div>}
            </Card>
            <div style={{ fontSize:13, color:CLR.neutral.muted, marginBottom:12 }}>Defina o limite mensal por categoria.</div>
            <Card>
              {categorias.map(cat=>(
                <div key={cat} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                  <span style={{ fontSize:14, flex:1, color:"#e2e8f0", display:"flex", alignItems:"center", gap:6 }}>
                    {cat}
                    {!CATEGORIAS_PADRAO.includes(cat)&&<span style={{ fontSize:10, background:"#1a1a3d", color:"#7b8cde", border:"1px solid #3a3a7a", borderRadius:99, padding:"1px 6px" }}>custom</span>}
                  </span>
                  <input type="number" placeholder="Sem limite" defaultValue={(data.orcamentos || {})[cat]||""} onChange={e=>setOrcEdit({...orcEdit,[cat]:parseFloat(e.target.value)||0})} style={{ ...baseInput, width:140, textAlign:"right" }} />
                </div>
              ))}
              <button onClick={saveOrcamento} style={{ ...baseBtn, background:"linear-gradient(90deg,#0d3d2e,#1a6647)", color:CLR.entrada.text, border:`1px solid ${CLR.entrada.border}`, width:"100%", padding:"10px", marginTop:8 }}>✓ Salvar orçamentos</button>
            </Card>
          </div>
        )}

        {/* HISTÓRICO */}
        {tab==="historico" && (
          <div>
            <SearchBar value={search} onChange={setSearch} />
            <div style={{ fontSize:12, color:CLR.neutral.muted, marginBottom:14 }}>{mesLabel} — todas as movimentações</div>
            {(()=>{
              const all=[...entradasMes.map(e=>({...e,tipo:"entrada"})),...gastosMes.map(g=>({...g,tipo:"gasto"}))].sort((a,b)=>new Date(b.data)-new Date(a.data));
              const filtered=search.trim()?all.filter(i=>[i.descricao,i.categoria||"",i.quem||"",i.responsavel||""].some(f=>f.toLowerCase().includes(search.toLowerCase()))):all;
              if(!filtered.length) return <div style={{ fontSize:13, color:CLR.neutral.muted, textAlign:"center", padding:"2rem 0" }}>Nenhuma movimentação encontrada.</div>;
              return filtered.map(item=><ItemRow key={item.id+item.tipo} item={item} tipo={item.tipo} onEdit={openEdit} onDelete={askDelete} onEfetivar={efetivar} />);
            })()}
          </div>
        )}

        {/* EXTRATO */}
        {tab==="extrato" && (
          <ExtratoTab
            categorias={categorias}
            onImportarItens={onImportarItens}
            showToast={showToast}
          />
        )}

        {/* BACKUP */}
        {tab==="backup" && (
          <div>
            {confirmRestore && (
              <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
                <div style={{ background:CLR.neutral.bg, border:`1px solid ${CLR.gasto.border}`, borderRadius:16, padding:"1.5rem", width:"100%", maxWidth:340 }}>
                  <div style={{ fontSize:15, fontWeight:600, color:CLR.gasto.text, marginBottom:10 }}>⚠️ Confirmar restauração</div>
                  <div style={{ fontSize:13, color:CLR.neutral.label, marginBottom:20 }}>Os dados atuais serão <strong style={{ color:"#e2e8f0" }}>substituídos</strong>. Esta ação não pode ser desfeita.</div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>setConfirmRestore(false)} style={{ ...baseBtn, flex:1, background:CLR.neutral.card, color:"#e2e8f0", border:`1px solid ${CLR.neutral.border}` }}>Cancelar</button>
                    <button onClick={restaurar} style={{ ...baseBtn, flex:1, background:CLR.gasto.bg, color:CLR.gasto.text, border:`1px solid ${CLR.gasto.border}` }}>Substituir</button>
                  </div>
                </div>
              </div>
            )}
            <Card style={{ marginBottom:16, border:`1px solid ${CLR.entrada.border}` }}>
              <div style={{ fontSize:14, fontWeight:600, color:CLR.entrada.text, marginBottom:4 }}>📦 Exportar backup</div>
              <div style={{ fontSize:12, color:CLR.neutral.muted, marginBottom:12 }}>Salva seus dados no dispositivo. Faça isso regularmente!</div>
              <div style={{ display:"grid", gap:8, fontSize:12, color:CLR.neutral.label, background:CLR.neutral.bg, borderRadius:10, padding:"10px 14px", marginBottom:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span>📈 Entradas</span><strong style={{ color:"#e2e8f0" }}>{(data.entradas || []).length}</strong></div>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span>📉 Gastos</span><strong style={{ color:"#e2e8f0" }}>{(data.gastos || []).length}</strong></div>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span>🎯 Orçamentos</span><strong style={{ color:"#e2e8f0" }}>{Object.keys(data.orcamentos||{}).length}</strong></div>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span>🏷️ Categorias extras</span><strong style={{ color:"#e2e8f0" }}>{(data.categoriasExtras||[]).length}</strong></div>
              </div>
              <button onClick={exportarJSON} style={{ ...baseBtn, width:"100%", padding:"10px", background:CLR.entrada.bg, color:CLR.entrada.text, border:`1px solid ${CLR.entrada.border}`, marginBottom:8 }}>⬇️ Baixar backup (.json)</button>
              <button onClick={exportarCSV}  style={{ ...baseBtn, width:"100%", padding:"10px", background:"#1a2e1a", color:"#6fcf97", border:"1px solid #2d6e2d" }}>📊 Exportar planilha (.csv)</button>
            </Card>
            <Card style={{ border:`1px solid ${CLR.parcela.border}` }}>
              <div style={{ fontSize:14, fontWeight:600, color:CLR.parcela.text, marginBottom:4 }}>📂 Restaurar backup</div>
              <div style={{ fontSize:12, color:CLR.neutral.muted, marginBottom:12 }}>Selecione um arquivo .json ou .csv exportado pelo app.</div>
              <div
                onDragOver={e=>{ e.preventDefault(); setDragOver(true); }}
                onDragLeave={()=>setDragOver(false)}
                onDrop={e=>{ e.preventDefault(); setDragOver(false); lerArquivo(e.dataTransfer.files[0]); }}
                onClick={()=>document.getElementById("fileInputApp").click()}
                style={{ border:`2px dashed ${dragOver?CLR.parcela.text:CLR.neutral.border}`, borderRadius:12, padding:"1.25rem", textAlign:"center", cursor:"pointer", background:dragOver?CLR.parcela.bg:"transparent", transition:"all 0.2s", marginBottom:10 }}>
                <div style={{ fontSize:26, marginBottom:4 }}>📁</div>
                <div style={{ fontSize:13, color:CLR.neutral.label }}>Arraste o arquivo ou clique para selecionar</div>
                <div style={{ fontSize:11, color:CLR.neutral.muted, marginTop:3 }}>Aceita .json (backup) ou .csv (planilha)</div>
                <input id="fileInputApp" type="file" accept=".json,.csv" style={{ display:"none" }} onChange={e=>lerArquivo(e.target.files[0])} />
              </div>
              {backupPreview && (
                <div style={{ background:CLR.parcela.bg, border:`1px solid ${CLR.parcela.border}`, borderRadius:10, padding:"1rem", marginBottom:8 }}>
                  <div style={{ fontSize:13, color:CLR.parcela.text, fontWeight:600, marginBottom:8 }}>✅ {backupPreview.tipo==="csv"?"CSV lido":"Backup válido"}:</div>
                  <div style={{ display:"flex", gap:16, flexWrap:"wrap", fontSize:13, color:CLR.neutral.label, marginBottom:10 }}>
                    <span>📈 <strong style={{ color:"#e2e8f0" }}>{backupPreview.entradas}</strong> entrada(s)</span>
                    <span>📉 <strong style={{ color:"#e2e8f0" }}>{backupPreview.gastos}</strong> gasto(s)</span>
                    {backupPreview.erros>0&&<span style={{ color:"#f59e0b" }}>⚠️ {backupPreview.erros} linha(s) ignorada(s)</span>}
                  </div>
                  {backupPreview.tipo==="csv" && (
                    <div style={{ marginBottom:12 }}>
                      <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#e2e8f0", marginBottom:6, cursor:"pointer" }}><input type="radio" checked={!backupPreview.merge} onChange={()=>setBackupPreview({...backupPreview,merge:false})} /> Substituir todos os dados</label>
                      <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#e2e8f0", cursor:"pointer" }}><input type="radio" checked={!!backupPreview.merge} onChange={()=>setBackupPreview({...backupPreview,merge:true})} /> Adicionar aos dados existentes</label>
                    </div>
                  )}
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={()=>setBackupPreview(null)} style={{ ...baseBtn, flex:1, background:CLR.neutral.card, color:"#e2e8f0", border:`1px solid ${CLR.neutral.border}` }}>Cancelar</button>
                    <button onClick={()=>setConfirmRestore(true)} style={{ ...baseBtn, flex:1, background:CLR.parcela.bg, color:CLR.parcela.text, border:`1px solid ${CLR.parcela.border}` }}>Importar dados</button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

      </div>
    </div>
  );
}
