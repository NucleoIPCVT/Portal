// Datas retiradas do Calendário Oficial de Datas Comemorativas da IPB de 2026.
// Fonte pública: https://www.ipb.org.br/content/Downloads/Calendario_2026.pdf
// Edição 2026: anos posteriores precisam de nova publicação oficial.
const rows = [
  ['2026-01-04','2026-01-10','Semana Mundial de Oração'],
  ['2026-02-01',null,'Dia do Homem Presbiteriano'],
  ['2026-02-08',null,'Dia da Mulher Presbiteriana'],
  ['2026-03-10',null,'Primeiro Culto Protestante no Brasil'],
  ['2026-03-11',null,'Dia da Educação Cristã'],
  ['2026-03-27',null,'Dia da Casa Editora Presbiteriana'],
  ['2026-04-03',null,'Dia da Paixão de Cristo'],
  ['2026-04-05',null,'Páscoa'],
  ['2026-05-03',null,'Dia do Músico Presbiteriano'],
  ['2026-05-10',null,'Dia das Mães'],
  ['2026-05-17',null,'Dia do Jovem Presbiteriano'],
  ['2026-06-10',null,'Instalada a Sociedade Bíblica do Brasil'],
  ['2026-07-01','2026-07-31','Mês dos Pastores Jubilados e Viúvas de Pastores'],
  ['2026-07-09',null,'Dia do Diácono Presbiteriano'],
  ['2026-07-26',null,'Dia do Adolescente Presbiteriano'],
  ['2026-08-02',null,'Dia do Doador de Sangue Presbiteriano'],
  ['2026-08-02',null,'Dia do Presbítero Presbiteriano'],
  ['2026-08-09',null,'Dia dos Pais'],
  ['2026-08-12',null,'Dia do Presbiterianismo Nacional e Dia das Missões'],
  ['2026-09-01','2026-09-30','Mês de aniversário do Jornal Brasil Presbiteriano'],
  ['2026-09-08',null,'Dia dos Seminários e Seminaristas'],
  ['2026-09-20',null,'Dia da Escola Dominical'],
  ['2026-10-11',null,'Dia da SAF em Revista'],
  ['2026-10-12',null,'Dia das Crianças e Dia Nacional das Crianças Presbiterianas'],
  ['2026-10-31',null,'Dia da Reforma Protestante'],
  ['2026-11-05',null,'Primeira circulação do jornal Imprensa Evangélica'],
  ['2026-11-11',null,'Dia Nacional da SAF'],
  ['2026-11-26',null,'Dia Nacional de Ação de Graças'],
  ['2026-11-30',null,'Dia do Teólogo'],
  ['2026-12-08',null,'Dia Nacional da Família'],
  ['2026-12-13',null,'Dia da Bíblia e Dia da Esposa do Pastor Presbiteriano'],
  ['2026-12-17',null,'Dia do Pastor Presbiteriano'],
  ['2026-12-25',null,'Natal'],
  ['2026-12-31',null,'Ano Novo']
];

export function officialIpbEvents2026() {
  return rows.map(([startDate,endDate,title],index)=>({
    id:'ipb-2026-'+startDate+'-'+String(index).padStart(2,'0'),
    source:'ipb-official-2026',
    sourceEventId:'ipb2026-'+String(index),
    title,
    startDate,
    endDate:endDate||startDate,
    allDay:true,
    startAt:null,
    endAt:null,
    description:'Calendário Oficial de Datas Comemorativas da Igreja Presbiteriana do Brasil, edição de 2026.',
    location:'',
    htmlLink:'https://www.ipb.org.br/content/Downloads/Calendario_2026.pdf',
    status:'confirmed'
  }));
}
