const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const os = require('os');
const ytSearch = require('yt-search');
const fs = require('fs');
const path = require('path');

let filaDeMusicas = []; 
let historicoDeMusicas = []; 

// Configurações Gerais e Ritmos
let configuracoes = { 
  alertaRepetidas: true, 
  reacoesAtivas: true, 
  pularAtivo: true,
  surpresaAtivo: true,
  pesquisaAtiva: true, // <--- NOVA CHAVE PARA BLOQUEAR A ENTRADA DE MÚSICAS
  estilos: {
    sertanejo: true, pagode: true, mpb: true, funk_classico: true, funk_atual: true, 
    pisadinha: true, rasqueado: true, gospel: true, modao: true
  }
}; 

function descobrirIP() {
  const interfaces = os.networkInterfaces();
  for (const nome in interfaces) {
    const nomePlaca = nome.toLowerCase();
    if (nomePlaca.includes('virtual') || nomePlaca.includes('wsl') || nomePlaca.includes('veth') || nomePlaca.includes('vmware')) continue;
    for (const iface of interfaces[nome]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '192.168.0.52';
}

const meuIP = descobrirIP();

function obterPlaylistEspera() {
  const pastaMusicas = path.join(__dirname, 'public', 'musicas_espera');
  try {
    if (!fs.existsSync(pastaMusicas)) {
        fs.mkdirSync(pastaMusicas, { recursive: true });
    }
    const arquivos = fs.readdirSync(pastaMusicas);
    return arquivos.filter(arq => arq.toLowerCase().endsWith('.mp3')).map(arq => 'musicas_espera/' + arq);
  } catch (e) {
    console.error("Erro ao ler pasta de músicas:", e);
    return [];
  }
}

app.use(express.static('public'));

app.get('/', (req, res) => res.sendFile(__dirname + '/public/host.html'));
app.get('/celular', (req, res) => res.sendFile(__dirname + '/public/celular.html'));
app.get('/admin', (req, res) => res.sendFile(__dirname + '/public/admin.html'));

io.on('connection', async (socket) => {
  socket.emit('atualizar_playlist_espera', obterPlaylistEspera());
  socket.emit('atualizar_fila', filaDeMusicas, false);
  socket.emit('atualizar_historico', historicoDeMusicas);
  socket.emit('atualizar_config', configuracoes);

  socket.on('enviar_emoji', (emoji) => {
    if (configuracoes.reacoesAtivas) io.emit('mostrar_emoji', emoji); 
  });

  socket.on('pesquisar_musica', async (termo) => {
    if (!configuracoes.pesquisaAtiva) return; // Bloqueia a pesquisa no servidor se estiver desligada
    try {
      const resultados = await ytSearch(termo + ' karaoke'); 
      let videosBons = [];
      for (let video of resultados.videos) {
        let titulo = video.title.toLowerCase();
        let nomeAutor = video.author.name.toLowerCase();
        let ehCanalOficial = nomeAutor.includes('vevo') || nomeAutor.includes('oficial') || nomeAutor.includes('official') || titulo.includes('oficial');
        let temKaraoke = titulo.includes('karaok') || titulo.includes('playback') || titulo.includes('instrumental') || titulo.includes('acústico') || titulo.includes('cover') || nomeAutor.includes('karaok') || nomeAutor.includes('playback') || nomeAutor.includes('teclas');
        if (temKaraoke && !ehCanalOficial) videosBons.push(video);
      }
      socket.emit('resultados_pesquisa', videosBons.slice(0, 5));
    } catch (err) { console.log('Erro na pesquisa:', err); }
  });

  socket.on('adicionar_musica', (dados) => {
    if (!configuracoes.pesquisaAtiva) return; // Bloqueia a adição direta no servidor
    dados.repetida = configuracoes.alertaRepetidas ? historicoDeMusicas.some(m => m.videoId === dados.videoId) : false;
    filaDeMusicas.push(dados);
    io.emit('atualizar_fila', filaDeMusicas, false); 
  });

  socket.on('controle_play_pause', () => { io.emit('comando_play_pause'); });
  socket.on('controle_reiniciar', () => { io.emit('comando_reiniciar'); });
  socket.on('musica_terminou', (foiPulo) => {
    if (filaDeMusicas.length > 0) {
      historicoDeMusicas.push(filaDeMusicas.shift());
      io.emit('atualizar_historico', historicoDeMusicas);
      io.emit('atualizar_fila', filaDeMusicas, !!foiPulo);
    }
  });

  socket.on('dj_remover_musica', (index) => {
    let foiPulo = (index === 0);
    if (index === 0) {
      historicoDeMusicas.push(filaDeMusicas.shift());
      io.emit('atualizar_historico', historicoDeMusicas);
    } else { filaDeMusicas.splice(index, 1); }
    io.emit('atualizar_fila', filaDeMusicas, foiPulo);
  });

  socket.on('dj_limpar_fila', () => {
    if (filaDeMusicas.length > 0) filaDeMusicas = [filaDeMusicas[0]]; 
    io.emit('atualizar_fila', filaDeMusicas, false);
  });

  socket.on('toggle_alerta', () => { configuracoes.alertaRepetidas = !configuracoes.alertaRepetidas; io.emit('atualizar_config', configuracoes); });
  socket.on('toggle_reacoes', () => { configuracoes.reacoesAtivas = !configuracoes.reacoesAtivas; io.emit('atualizar_config', configuracoes); });
  socket.on('toggle_pular', () => { configuracoes.pularAtivo = !configuracoes.pularAtivo; io.emit('atualizar_config', configuracoes); });
  socket.on('toggle_surpresa', () => { configuracoes.surpresaAtivo = !configuracoes.surpresaAtivo; io.emit('atualizar_config', configuracoes); });
  socket.on('toggle_pesquisa', () => { configuracoes.pesquisaAtiva = !configuracoes.pesquisaAtiva; io.emit('atualizar_config', configuracoes); }); // NOVO: Botão de pesquisa do DJ
  socket.on('toggle_estilo', (estilo) => {
    if (configuracoes.estilos[estilo] !== undefined) {
      configuracoes.estilos[estilo] = !configuracoes.estilos[estilo];
      io.emit('atualizar_config', configuracoes);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`\n=== KARAOKÊ DO DILA LIGADO ===`);
  console.log(`Servidor a correr na porta: ${PORT}`);
  console.log(`Se estiver rodando no seu computador (Localmente):`);
  console.log(`Ecrã da TV: http://localhost:${PORT}/`);
  console.log(`Painel DJ:  http://localhost:${PORT}/admin`);
  console.log(`Telemóvel:  http://${meuIP}:${PORT}/celular\n`);
});