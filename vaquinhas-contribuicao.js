const maxAmount = 1000000;
const maxItems = 1000;

function parseAmount(input) {
    const value = input.trim();
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(value)) {
        return Number(value.replaceAll('.', '').replace(',', '.'));
    }
    if (/^\d+([.,]\d{1,2})?$/.test(value)) return Number(value.replace(',', '.'));
    return NaN;
}

function formatPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const parts = /^(55)?(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
    if (!parts) return String(value || '').trim();
    return (parts[1] ? '+55 ' : '') + '(' + parts[2] + ') ' + parts[3] + '-' + parts[4];
}

const remaining = item => Number(item.needed) - Number(item.pledged || 0);
const findItem = (camp, id) => (camp.itemsNeeded || []).find(item => String(item.id) === id);
const unitCents = camp => Math.round(Number(camp.quotaValue) * 100);

export function initContributionFlow({getCampaign, formatCurrency, save}) {
    const el = id => document.getElementById(id);
    const dialog = el('contribution-dialog');
    const entry = el('contrib-entry');
    const review = el('contrib-review');
    const name = el('contrib-name');
    const itemSelect = el('c-item-select');
    const itemQty = el('c-item-qty');
    const quotaQty = el('c-quota-qty');
    const finish = el('contrib-finish');
    const back = el('contrib-back');
    const error = el('contrib-error');
    let displayedUnitCents = 0;
    let draft = null;
    let saving = false;

    function reset() {
        draft = null;
        if (dialog.open) dialog.close();
        el('contrib-status').textContent = '';
    }

    function refresh() {
        const camp = getCampaign();
        if (!camp) return reset();
        let message = '';
        if (camp.type === 'item' && camp.mode === 'fixed' && !(camp.itemsNeeded || []).some(item => remaining(item) > 0)) {
            message = 'Todos os itens desta lista já foram atendidos.';
        } else if (camp.type === 'finance' && ['fixed', 'person'].includes(camp.mode) && !(unitCents(camp) > 0)) {
            message = 'Consulte a pessoa responsável para saber o valor desta vaquinha.';
        }
        el('contrib-open').disabled = saving || Boolean(message);
        el('contrib-availability').textContent = message;
    }

    function setItemLimit(camp) {
        const item = findItem(camp, itemSelect.value);
        itemQty.max = String(item ? Math.min(maxItems, remaining(item)) : maxItems);
    }

    function loadItems(camp) {
        const previous = itemSelect.value;
        const options = (camp.itemsNeeded || []).filter(item => remaining(item) > 0).map(item =>
            new Option(item.name + ' · faltam ' + remaining(item), String(item.id))
        );
        itemSelect.replaceChildren(...options);
        if (options.some(option => option.value === previous)) itemSelect.value = previous;
        setItemLimit(camp);
        el('contrib-next').disabled = !options.length;
    }

    function updateQuotaTotal() {
        const count = quotaQty.valueAsNumber;
        el('c-quota-total').textContent = Number.isInteger(count) && count > 0
            ? 'Total de ' + formatCurrency(count * displayedUnitCents / 100) : '';
    }

    function showUnitPrice(camp) {
        displayedUnitCents = unitCents(camp);
        const price = formatCurrency(displayedUnitCents / 100);
        el('c-quota-price').textContent = 'Cada cota custa ' + price + '.';
        el('c-person-price').textContent = price;
        updateQuotaTotal();
    }

    function showEntry() {
        draft = null;
        entry.hidden = false;
        review.hidden = true;
        error.textContent = '';
        el('contrib-step').textContent = 'Etapa 1 de 2';
        el('contrib-heading').textContent = 'Sua contribuição';
        dialog.scrollTop = 0;
        if (dialog.open) name.focus();
    }

    el('contrib-open').addEventListener('click', () => {
        const camp = getCampaign();
        if (!camp || saving || dialog.open) return;
        const mode = camp.type + '-' + (['fixed', 'person'].includes(camp.mode) ? camp.mode : 'open');
        entry.reset();
        el('contrib-status').textContent = '';
        el('contrib-campaign').textContent = camp.title;
        el('contrib-next').disabled = false;
        el('contrib-next').textContent = camp.type === 'finance' ? 'Ver dados do Pix' : 'Revisar doação';
        entry.querySelectorAll('fieldset').forEach(group => {
            const active = group.dataset.modes.split(' ').includes(mode);
            group.disabled = !active;
            group.hidden = !active;
        });
        if (mode === 'item-fixed') loadItems(camp);
        else itemQty.max = String(maxItems);
        if (mode === 'finance-fixed' || mode === 'finance-person') showUnitPrice(camp);
        showEntry();
        dialog.showModal();
    });

    quotaQty.addEventListener('input', updateQuotaTotal);
    itemSelect.addEventListener('change', () => setItemLimit(getCampaign()));
    el('contrib-cancel').addEventListener('click', () => dialog.close());
    back.addEventListener('click', () => { if (saving) dialog.close(); else showEntry(); });

    function reviewPayment(camp) {
        const key = String(camp.pixKey || '').trim();
        el('contrib-key').textContent = key || 'Peça a chave à pessoa responsável pela vaquinha.';
        el('contrib-holder').textContent = String(camp.pixName || '').trim() || 'Confirme o titular com a pessoa responsável.';
        el('contrib-bank-instruction').textContent = key
            ? 'Abra o app do seu banco e use esta chave.'
            : 'Combine os dados para o pagamento com a pessoa responsável.';
        el('contrib-copy').hidden = !key;
        el('contrib-copy').textContent = 'Copiar chave Pix';
        el('contrib-copy-status').textContent = '';
        el('contrib-contact-name').textContent = String(camp.receiptName || '').trim() || 'a pessoa responsável pela vaquinha';
        el('contrib-contact-phone').textContent = formatPhone(camp.receiptPhone);
    }

    function checkItem(camp, id, quantity) {
        const item = findItem(camp, id);
        if (item && quantity <= remaining(item)) return item;
        showEntry();
        loadItems(camp);
        error.textContent = itemSelect.options.length
            ? 'A lista foi atualizada. Confira o item e a quantidade disponível.'
            : 'Todos os itens desta lista já foram atendidos.';
        return null;
    }

    entry.addEventListener('submit', event => {
        event.preventDefault();
        const camp = getCampaign();
        if (!camp || saving) return;
        error.textContent = '';
        const data = {campaignId: String(camp.id), name: name.value.trim(), type: camp.type};
        if (!data.name) {
            error.textContent = 'Informe seu nome para continuar.';
            name.focus();
            return;
        }

        const finance = camp.type === 'finance';
        let summary;
        if (finance) {
            const count = camp.mode === 'fixed' ? quotaQty.valueAsNumber : 1;
            const priced = camp.mode === 'fixed' || camp.mode === 'person';
            if (priced && unitCents(camp) !== displayedUnitCents) {
                showUnitPrice(camp);
                error.textContent = 'O valor desta vaquinha mudou. Confira o novo valor antes de continuar.';
                return;
            }
            data.amount = priced ? count * displayedUnitCents / 100 : parseAmount(el('c-amount').value);
            if (!Number.isInteger(count) || !Number.isFinite(data.amount) || data.amount <= 0 || data.amount > maxAmount) {
                error.textContent = 'Informe um valor entre R$ 0,01 e R$ 1.000.000,00.';
                return;
            }
            summary = camp.mode === 'fixed'
                ? count + (count === 1 ? ' cota de ' : ' cotas de ') + formatCurrency(unitCents(camp) / 100) + ' · ' : '';
            summary += 'Total de ' + formatCurrency(data.amount);
            reviewPayment(camp);
        } else {
            data.quantity = itemQty.valueAsNumber;
            if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > maxItems) {
                error.textContent = 'Informe uma quantidade inteira entre 1 e 1.000.';
                return;
            }
            if (camp.mode === 'fixed') {
                const item = checkItem(camp, itemSelect.value, data.quantity);
                if (!item) return;
                data.itemId = String(item.id);
                data.itemName = item.name;
            } else {
                data.itemName = el('c-item-name').value.trim();
                if (!data.itemName) {
                    error.textContent = 'Informe o item que você vai levar.';
                    el('c-item-name').focus();
                    return;
                }
            }
            summary = data.quantity + ' × ' + data.itemName;
        }

        draft = data;
        el('contrib-review-name').textContent = data.name;
        el('contrib-review-total').textContent = summary;
        el('contrib-step').textContent = 'Etapa 2 de 2';
        el('contrib-heading').textContent = finance ? 'Faça o Pix' : 'Confira sua doação';
        el('contrib-payment').hidden = !finance;
        el('contrib-item-instruction').hidden = finance;
        entry.hidden = true;
        review.hidden = false;
        el('contrib-heading').focus();
        dialog.scrollTop = 0;
    });

    el('contrib-copy').addEventListener('click', async () => {
        const key = el('contrib-key');
        const feedback = el('contrib-copy-status');
        let copied = false;
        try {
            await navigator.clipboard.writeText(key.textContent);
            copied = true;
        } catch {
            const range = document.createRange();
            range.selectNodeContents(key);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            try { copied = document.execCommand('copy'); } catch { /* A chave continua selecionada. */ }
        }
        el('contrib-copy').textContent = copied ? 'Chave Pix copiada' : 'Copiar chave Pix';
        feedback.textContent = copied ? '' : 'A chave está selecionada. Use a opção Copiar do seu aparelho.';
    });

    finish.addEventListener('click', async () => {
        const camp = getCampaign();
        if (saving || !draft || !camp || draft.campaignId !== String(camp.id)) return;
        if (draft.itemId && !checkItem(camp, draft.itemId, draft.quantity)) return;
        if (navigator.onLine === false) {
            error.textContent = 'Você está sem conexão. Quando a internet voltar, toque em Concluir.';
            return;
        }
        const submitted = draft;
        saving = true;
        refresh();
        finish.disabled = true;
        back.textContent = 'Fechar';
        finish.textContent = 'Registrando…';
        el('contrib-status').textContent = 'Registrando sua contribuição…';
        error.textContent = '';
        try {
            await save(submitted);
            if (draft !== submitted) return;
            draft = null;
            const wasOpen = dialog.open;
            if (wasOpen) dialog.close();
            el('contrib-status').textContent = 'Contribuição registrada! Aguardando confirmação da pessoa responsável.';
            if (wasOpen) el('contrib-status').focus();
        } catch (cause) {
            console.error('Falha ao registrar contribuição:', cause);
            if (draft === submitted) {
                el('contrib-status').textContent = dialog.open ? '' : 'Não foi possível registrar. Confira a conexão e toque em Contribuir para tentar novamente.';
                error.textContent = 'Não foi possível registrar. Verifique a conexão e toque em Concluir para tentar novamente.';
            }
        } finally {
            saving = false;
            finish.disabled = false;
            back.textContent = 'Voltar';
            finish.textContent = 'Concluir';
            refresh();
        }
    });

    return {refresh, reset};
}
