/**
 * Gerenciador de Análises do Dia
 * Sistema modular para cards administrativos
 */

class AnalysisManager {
  constructor() {
    this.cards = [];
    this.isAdmin = false;
    this.currentEditCard = null;
    this.modal = null;
    this.adminPassword = 'admin123'; // Em produção, usar hash seguro
    
    this.init();
  }

  init() {
    this.loadCards();
    this.bindEvents();
    this.checkAdminStatus();
    this.updateUI();
  }

  loadCards() {
    try {
      const saved = localStorage.getItem('analysis_cards');
      this.cards = saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error('Erro ao carregar cards:', error);
      this.cards = [];
    }
  }

  saveCards() {
    try {
      localStorage.setItem('analysis_cards', JSON.stringify(this.cards));
    } catch (error) {
      console.error('Erro ao salvar cards:', error);
    }
  }

  checkAdminStatus() {
    // Verificar se usuário é admin (em produção, implementar autenticação real)
    this.isAdmin = sessionStorage.getItem('admin_logged') === 'true';
    this.updateAdminControls();
  }

  updateAdminControls() {
    const addBtn = document.getElementById('addAnalysisCard');
    
    if (addBtn) {
      addBtn.style.display = this.isAdmin ? 'inline-flex' : 'none';
    }
  }

  bindEvents() {
    // Botão de atualizar
    const refreshBtn = document.getElementById('refreshAnalysis');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refreshAnalysis());
    }

    // Botão de adicionar card
    const addBtn = document.getElementById('addAnalysisCard');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.openCardModal());
    }

    // Fechar modal com ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal) {
        this.closeModal();
      }
    });
  }

  refreshAnalysis() {
    this.updateUI();
    this.showNotification('Análises atualizadas', 'success');
  }

  updateUI() {
    this.renderCards();
    this.updateHeader();
  }

  renderCards() {
    const grid = document.getElementById('analysisGrid');
    const noMessage = document.getElementById('noCardsMessage');
    
    if (!grid) return;

    // Limpar grid
    grid.innerHTML = '';

    if (this.cards.length === 0) {
      if (noMessage) noMessage.style.display = 'block';
      return;
    }

    if (noMessage) noMessage.style.display = 'none';

    // Renderizar cards
    this.cards.forEach(card => {
      const cardElement = this.createCardElement(card);
      grid.appendChild(cardElement);
    });
  }

  createCardElement(card) {
    const cardDiv = document.createElement('div');
    cardDiv.className = `analysis-card ${this.isAdmin ? 'admin-mode' : ''}`;
    cardDiv.dataset.id = card.id;

    const formattedDate = new Date(card.createdAt).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    cardDiv.innerHTML = `
      <div class="analysis-card__header">
        <div>
          <h3 class="analysis-card__title">${this.escapeHtml(card.title)}</h3>
          <p class="analysis-card__subtitle">${this.escapeHtml(card.category)}</p>
        </div>
        ${this.isAdmin ? `
          <div class="analysis-card__controls">
            <button class="analysis-card__control-btn edit" onclick="analysisManager.editCard('${card.id}')" title="Editar">
              ✏️
            </button>
            <button class="analysis-card__control-btn delete" onclick="analysisManager.deleteCard('${card.id}')" title="Excluir">
              🗑️
            </button>
          </div>
        ` : ''}
      </div>
      <div class="analysis-card__content">
        ${this.formatContent(card.content)}
      </div>
      <div class="analysis-card__footer">
        <span class="analysis-card__author">Por: ${this.escapeHtml(card.author)}</span>
        <span class="analysis-card__timestamp">${formattedDate}</span>
      </div>
    `;

    return cardDiv;
  }

  formatContent(content) {
    // Converter quebras de linha em parágrafos
    return content.split('\n').map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      return `<p>${this.escapeHtml(trimmed)}</p>`;
    }).join('');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  openCardModal(cardId = null) {
    if (!this.isAdmin) {
      this.showNotification('Acesso negado. Apenas administradores podem gerenciar cards.', 'error');
      return;
    }

    this.currentEditCard = cardId;
    const card = cardId ? this.cards.find(c => c.id === cardId) : null;

    const modal = this.createModal(card);
    document.body.appendChild(modal);
    this.modal = modal;
    modal.classList.add('active');

    // Focar no primeiro input
    const firstInput = modal.querySelector('input, textarea, select');
    if (firstInput) firstInput.focus();
  }

  createModal(card = null) {
    const modal = document.createElement('div');
    modal.className = 'admin-modal';
    modal.innerHTML = `
      <div class="admin-modal__content">
        <div class="admin-modal__header">
          <h2 class="admin-modal__title">${card ? 'Editar Card' : 'Novo Card de Análise'}</h2>
          <button class="admin-modal__close" onclick="analysisManager.closeModal()">×</button>
        </div>
        <form class="admin-form" onsubmit="analysisManager.saveCard(event)">
          <div class="form-group">
            <label class="form-label">Título</label>
            <input type="text" class="form-input" name="title" required 
                   value="${card ? this.escapeHtml(card.title) : ''}" 
                   placeholder="Título da análise">
          </div>
          
          <div class="form-group">
            <label class="form-label">Categoria</label>
            <select class="form-select" name="category" required>
              <option value="">Selecione uma categoria</option>
              <option value="Mercado" ${card && card.category === 'Mercado' ? 'selected' : ''}>Mercado</option>
              <option value="ADRs" ${card && card.category === 'ADRs' ? 'selected' : ''}>ADRs</option>
              <option value="Commodities" ${card && card.category === 'Commodities' ? 'selected' : ''}>Commodities</option>
              <option value="Indicadores" ${card && card.category === 'Indicadores' ? 'selected' : ''}>Indicadores</option>
              <option value="Análise Técnica" ${card && card.category === 'Análise Técnica' ? 'selected' : ''}>Análise Técnica</option>
              <option value="Outro" ${card && card.category === 'Outro' ? 'selected' : ''}>Outro</option>
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">Conteúdo da Análise</label>
            <textarea class="form-textarea" name="content" required 
                      placeholder="Digite aqui sua análise...&#10;&#10;• Ponto importante&#10;• Outro ponto&#10;&#10;Use quebras de linha para separar parágrafos.">${card ? this.escapeHtml(card.content) : ''}</textarea>
          </div>
          
          <div class="form-group">
            <label class="form-label">Autor</label>
            <input type="text" class="form-input" name="author" required 
                   value="${card ? this.escapeHtml(card.author) : ''}" 
                   placeholder="Seu nome">
          </div>
          
          <div class="form-actions">
            <button type="button" class="btn btn--secondary" onclick="analysisManager.closeModal()">Cancelar</button>
            <button type="submit" class="btn btn--primary">${card ? 'Atualizar' : 'Criar'} Card</button>
          </div>
        </form>
      </div>
    `;

    return modal;
  }

  saveCard(event) {
    event.preventDefault();
    
    if (!this.isAdmin) {
      this.showNotification('Acesso negado.', 'error');
      return;
    }

    const formData = new FormData(event.target);
    const cardData = {
      title: formData.get('title').trim(),
      category: formData.get('category'),
      content: formData.get('content').trim(),
      author: formData.get('author').trim()
    };

    if (!this.validateCard(cardData)) {
      return;
    }

    if (this.currentEditCard) {
      // Editar card existente
      const index = this.cards.findIndex(c => c.id === this.currentEditCard);
      if (index !== -1) {
        this.cards[index] = {
          ...this.cards[index],
          ...cardData,
          updatedAt: new Date().toISOString()
        };
        this.showNotification('Card atualizado com sucesso!', 'success');
      }
    } else {
      // Novo card
      const newCard = {
        id: this.generateId(),
        ...cardData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.cards.push(newCard);
      this.showNotification('Card criado com sucesso!', 'success');
    }

    this.saveCards();
    this.closeModal();
    this.updateUI();
  }

  validateCard(data) {
    if (!data.title || data.title.length < 3) {
      this.showNotification('Título deve ter pelo menos 3 caracteres.', 'error');
      return false;
    }
    
    if (!data.category) {
      this.showNotification('Selecione uma categoria.', 'error');
      return false;
    }
    
    if (!data.content || data.content.length < 10) {
      this.showNotification('Conteúdo deve ter pelo menos 10 caracteres.', 'error');
      return false;
    }
    
    if (!data.author || data.author.length < 2) {
      this.showNotification('Nome do autor é obrigatório.', 'error');
      return false;
    }
    
    return true;
  }

  editCard(cardId) {
    this.openCardModal(cardId);
  }

  deleteCard(cardId) {
    if (!confirm('Tem certeza que deseja excluir este card? Esta ação não pode ser desfeita.')) {
      return;
    }
    
    this.cards = this.cards.filter(c => c.id !== cardId);
    this.saveCards();
    this.updateUI();
    this.showNotification('Card excluído com sucesso!', 'success');
  }

  closeModal() {
    if (this.modal) {
      this.modal.classList.remove('active');
      setTimeout(() => {
        this.modal.remove();
        this.modal = null;
      }, 300);
    }
    this.currentEditCard = null;
  }

  generateId() {
    return 'card_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  updateHeader() {
    const dateEl = document.getElementById('analysisDate');
    const countEl = document.getElementById('analysisCount');
    
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('pt-BR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
    
    if (countEl) {
      countEl.textContent = `${this.cards.length} card${this.cards.length !== 1 ? 's' : ''}`;
    }
  }

  showNotification(message, type = 'info') {
    // Criar elemento de notificação
    const notification = document.createElement('div');
    notification.className = `notification notification--${type}`;
    notification.innerHTML = `
      <span class="notification__message">${message}</span>
      <button class="notification__close" onclick="this.parentElement.remove()">×</button>
    `;
    
    document.body.appendChild(notification);
    
    // Remover automaticamente após 5 segundos
    setTimeout(() => {
      if (notification.parentElement) {
        notification.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => notification.remove(), 300);
      }
    }, 5000);
  }

  // Método público para ser chamado de fora
  openAdminPanel() {
    const password = prompt('Digite a senha de administrador:');
    if (password === this.adminPassword) {
      this.isAdmin = true;
      sessionStorage.setItem('admin_logged', 'true');
      this.updateAdminControls();
      this.updateUI();
      this.showNotification('Modo administrador ativado!', 'success');
    } else {
      this.showNotification('Senha incorreta!', 'error');
    }
  }
}

// Inicializar quando DOM estiver carregado
let analysisManager;
document.addEventListener('DOMContentLoaded', () => {
  analysisManager = new AnalysisManager();
});

// Exportar para uso global (compatibilidade com código existente)
window.analysisManager = analysisManager;

// Função global para ser chamada pelo botão Admin
function openAdminPanel() {
  if (window.analysisManager) {
    window.analysisManager.openAdminPanel();
  }
}
