/* Seletor de imagens da página "Meu dia". A preferência fica neste navegador, por conta. */
const storagePrefix='ipcvt-planner-meu-dia-tema-v1:'
const monthlyArt=[
  {month:1,label:'Janeiro',theme:'Semana de Oração',src:'planner-month-art/planner-month-01-hd.avif',ready:true},
  {month:2,label:'Fevereiro',theme:'Homem e Mulher Presbiterianos',src:'planner-month-art/planner-month-02-hd.avif',ready:true},
  {month:3,label:'Março',theme:'Protestantismo no Brasil',src:'planner-month-art/planner-month-03-hd.avif',ready:true},
  {month:4,label:'Abril',theme:'Páscoa',src:'planner-month-art/planner-month-04.webp',ready:true},
  {month:5,label:'Maio',theme:'Aniversário da IPCVT',src:'planner-month-art/planner-month-05.avif',ready:true},
  {month:6,label:'Junho',theme:'Comunhão e Palavra',src:'planner-hero-mission.svg',ready:false},
  {month:7,label:'Julho',theme:'Cuidado e gratidão',src:'planner-hero-worship.svg',ready:false},
  {month:8,label:'Agosto',theme:'Missões e Presbiterianismo',src:'planner-hero-mission.svg',ready:false},
  {month:9,label:'Setembro',theme:'Discipulado e ensino',src:'planner-hero-reformation.svg',ready:false},
  {month:10,label:'Outubro',theme:'Reforma e Palavra',src:'planner-hero-reformation.svg',ready:false},
  {month:11,label:'Novembro',theme:'Ação de Graças',src:'planner-hero-mission.svg',ready:false},
  {month:12,label:'Dezembro',theme:'Natal',src:'planner-hero-advent.svg',ready:false}
]
const storageKey=email=>storagePrefix+(String(email||'visitante').trim().toLowerCase())
function readSettings(email){
  try{
    const data=JSON.parse(localStorage.getItem(storageKey(email))||'null')
    if(data&&data.mode==='manual'&&Number.isInteger(data.month)&&data.month>=1&&data.month<=12)return data
  }catch{}
  return {mode:'automatic',month:null}
}
function writeSettings(email,settings){
  try{localStorage.setItem(storageKey(email),JSON.stringify(settings))}catch{}
}
export function selectedHomeImageMonth(currentMonth,email){
  const settings=readSettings(email)
  return settings.mode==='manual'?settings.month:currentMonth
}
export function setupHomeImageSettings({getEmail,onApply}){
  const menu=document.querySelector('#pm-more .pm-more-menu')
  if(!menu||document.getElementById('pm-configurar-temas'))return
  const trigger=document.createElement('button')
  trigger.type='button';trigger.id='pm-configurar-temas';trigger.textContent='Configurar temas'
  trigger.title='Configurar imagens da página Meu dia'
  menu.insertBefore(trigger,document.getElementById('pm-theme'))
  const dialog=document.createElement('dialog')
  dialog.id='pm-home-themes-dialog'
  dialog.className='pm-home-theme-dialog'
  dialog.setAttribute('aria-labelledby','pm-home-themes-title')
  dialog.innerHTML=`
    <div class="pm-home-themes-head">
      <div><span class="pm-home-themes-eyebrow">APARÊNCIA DO PLANNER</span>
        <h2 id="pm-home-themes-title">Temas do Meu Dia</h2>
        <p>Teste as imagens e escolha como elas aparecem na página inicial.</p></div>
      <button type="button" class="pm-home-themes-close" aria-label="Fechar">×</button>
    </div>
    <div class="pm-home-themes-content">
      <fieldset class="pm-home-themes-modes"><legend>Exibição da imagem</legend>
        <label><input type="radio" name="pm-home-theme-mode" value="automatic"> Automático por mês <small>Mostra a imagem correspondente ao mês atual.</small></label>
        <label><input type="radio" name="pm-home-theme-mode" value="manual"> Selecionar imagem <small>Fixa um mês para testar, independentemente da data.</small></label>
      </fieldset>
      <div class="pm-home-themes-preview" aria-label="Prévia da imagem">
        <img id="pm-home-themes-preview-image" alt="Prévia da imagem selecionada">
        <span class="pm-home-themes-preview-shade"></span>
        <div class="pm-home-themes-preview-text">
          <span>PLANNER IPCVT</span><strong>Meu dia</strong><small id="pm-home-themes-preview-label"></small>
        </div>
      </div>
      <p class="pm-home-themes-hint" id="pm-home-themes-hint"></p>
      <div class="pm-home-themes-grid" id="pm-home-themes-grid" role="group" aria-label="Escolha uma imagem entre os 12 meses"></div>
    </div>
    <div class="pm-home-themes-footer">
      <span id="pm-home-themes-feedback" role="status" aria-live="polite"></span>
      <button type="button" class="pm-home-themes-apply">Ver no Meu Dia</button>
    </div>`
  document.body.append(dialog)
  const modeRadios=[...dialog.querySelectorAll('input[name="pm-home-theme-mode"]')]
  const grid=dialog.querySelector('#pm-home-themes-grid')
  const preview=dialog.querySelector('#pm-home-themes-preview-image')
  const previewLabel=dialog.querySelector('#pm-home-themes-preview-label')
  const hint=dialog.querySelector('#pm-home-themes-hint')
  const feedback=dialog.querySelector('#pm-home-themes-feedback')
  const currentCalendarMonth=()=>new Date().getMonth()+1
  let chosen=readSettings(getEmail())
  let lastManualMonth=chosen.month||currentCalendarMonth()
  const monthButtons=[]
  for(const item of monthlyArt){
    const card=document.createElement('button')
    card.type='button';card.className='pm-home-theme-month'
    card.setAttribute('aria-label',item.label+': '+item.theme+(item.ready?'':' (arte provisória)'))
    const image=document.createElement('img')
    image.src=item.src;image.alt='';image.loading='lazy'
    const meta=document.createElement('span')
    meta.className='pm-home-theme-month-info'
    const monthName=document.createElement('strong');monthName.textContent=item.label
    const note=document.createElement('small');note.textContent=item.ready?item.theme:'Arte anterior · provisória'
    meta.append(monthName,note);card.append(image,meta)
    card.addEventListener('click',()=>{
      lastManualMonth=item.month
      chosen={mode:'manual',month:item.month}
      updatePreview()
      persist()
    })
    grid.append(card);monthButtons.push([item.month,card])
  }
  function updatePreview(){
    const shownMonth=chosen.mode==='manual'?chosen.month:currentCalendarMonth()
    const item=monthlyArt[shownMonth-1]
    preview.src=item.src
    preview.alt='Prévia de '+item.label+': '+item.theme
    previewLabel.textContent=item.label+' · '+item.theme
    for(const radio of modeRadios)radio.checked=radio.value===chosen.mode
    for(const [month,card] of monthButtons){
      const active=shownMonth===month
      card.classList.toggle('is-selected',active)
      card.setAttribute('aria-pressed',String(active))
    }
    grid.classList.toggle('pm-home-themes-automatic',chosen.mode==='automatic')
    hint.textContent=chosen.mode==='automatic'
      ? 'Modo automático ativo: '+item.label+' é a imagem exibida no mês atual. Clique em outro mês para testá-lo.'
      : (item.ready?'Seleção manual: '+item.label+'. A imagem também será aplicada à página Meu Dia.':'Seleção manual: '+item.label+'. Este mês ainda utiliza uma ilustração anterior, até receber sua aquarela definitiva.')
  }
  function persist(){
    writeSettings(getEmail(),chosen)
    feedback.textContent=chosen.mode==='automatic'?'Alternância mensal ativada.':'Imagem de '+monthlyArt[chosen.month-1].label+' selecionada.'
    onApply()
  }
  modeRadios.forEach(radio=>radio.addEventListener('change',()=>{
    chosen=radio.value==='automatic'
      ?{mode:'automatic',month:null}
      :{mode:'manual',month:lastManualMonth}
    updatePreview();persist()
  }))
  dialog.querySelector('.pm-home-themes-close').addEventListener('click',()=>dialog.close())
  dialog.querySelector('.pm-home-themes-apply').addEventListener('click',()=>{dialog.close();onApply(true)})
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()})
  trigger.addEventListener('click',()=>{
    document.getElementById('pm-more').open=false
    chosen=readSettings(getEmail())
    lastManualMonth=chosen.month||currentCalendarMonth()
    feedback.textContent=''
    updatePreview()
    dialog.showModal()
  })
}
