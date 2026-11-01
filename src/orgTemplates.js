// Föreslagna kategoriupplägg per föreningstyp. Väljs när en förening skapas och kan ändras fritt efteråt.
// Koder: I01… för intäkter, U01… för kostnader. Namnen finns på svenska och engelska.
const inc = (id, sv, en) => ({ id, type: 'income', sv, en })
const exp = (id, sv, en) => ({ id, type: 'expense', sv, en })

export const ORG_TEMPLATES = [
  {
    id: 'allman',
    label: { sv: 'Allmän förening', en: 'General association' },
    desc:  { sv: 'Ett enkelt upplägg som passar de flesta ideella föreningar.', en: 'A simple setup that suits most non-profit associations.' },
    categories: [
      inc('I01', 'Medlemsavgifter', 'Membership fees'), inc('I02', 'Bidrag och gåvor', 'Grants and donations'),
      inc('I03', 'Aktivitetsintäkter', 'Activity income'), inc('I04', 'Försäljningsintäkter', 'Sales income'),
      inc('I05', 'Sponsring', 'Sponsorship'), inc('I06', 'Ränteintäkter', 'Interest income'), inc('I07', 'Övriga intäkter', 'Other income'),
      exp('U01', 'Lokalkostnader', 'Premises costs'), exp('U02', 'Aktivitetskostnader', 'Activity costs'),
      exp('U03', 'Administration', 'Administration'), exp('U04', 'Marknadsföring', 'Marketing'),
      exp('U05', 'Utrustning och inventarier', 'Equipment and inventory'), exp('U06', 'Löner och arvoden', 'Salaries and fees'),
      exp('U07', 'Resor och transporter', 'Travel and transport'), exp('U08', 'Förbrukningsvaror', 'Consumables'),
      exp('U09', 'IT och kommunikation', 'IT and communications'), exp('U10', 'Övriga kostnader', 'Other expenses'),
    ],
  },
  {
    id: 'idrott',
    label: { sv: 'Idrottsförening', en: 'Sports club' },
    desc:  { sv: 'Träningsavgifter, LOK-stöd, cuper, domare och anläggningar.', en: 'Training fees, activity grants, tournaments, referees and facilities.' },
    categories: [
      inc('I01', 'Medlemsavgifter', 'Membership fees'), inc('I02', 'Träningsavgifter', 'Training fees'),
      inc('I03', 'Kommunala bidrag', 'Municipal grants'), inc('I04', 'LOK-stöd och idrottsbidrag', 'Activity and sports grants'),
      inc('I05', 'Sponsring', 'Sponsorship'), inc('I06', 'Cuper och arrangemang', 'Tournaments and events'),
      inc('I07', 'Försäljning (kiosk, lotter, kläder)', 'Sales (kiosk, raffles, clothing)'), inc('I08', 'Övriga intäkter', 'Other income'),
      exp('U01', 'Hyra av hall och anläggning', 'Hall and facility rent'), exp('U02', 'Tränar- och ledararvoden', 'Coach and leader fees'),
      exp('U03', 'Domare och funktionärer', 'Referees and officials'), exp('U04', 'Serie-, cup- och anmälningsavgifter', 'League, tournament and entry fees'),
      exp('U05', 'Resor och boende', 'Travel and accommodation'), exp('U06', 'Utrustning och matchkläder', 'Equipment and kit'),
      exp('U07', 'Utbildning', 'Training and courses'), exp('U08', 'Försäkringar', 'Insurance'),
      exp('U09', 'Administration', 'Administration'), exp('U10', 'Marknadsföring', 'Marketing'), exp('U11', 'Övriga kostnader', 'Other expenses'),
    ],
  },
  {
    id: 'brf',
    label: { sv: 'Bostadsrättsförening (brf)', en: 'Housing cooperative' },
    desc:  { sv: 'Årsavgifter, drift, underhåll, förvaltning och räntor.', en: 'Annual fees, operations, maintenance, management and interest.' },
    categories: [
      inc('I01', 'Årsavgifter', 'Annual fees'), inc('I02', 'Hyresintäkter (lokaler och bostäder)', 'Rental income (premises and flats)'),
      inc('I03', 'Parkering och garage', 'Parking and garages'), inc('I04', 'Överlåtelse- och pantsättningsavgifter', 'Transfer and pledge fees'),
      inc('I05', 'Ränteintäkter', 'Interest income'), inc('I06', 'Övriga intäkter', 'Other income'),
      exp('U01', 'El', 'Electricity'), exp('U02', 'Värme', 'Heating'), exp('U03', 'Vatten och avlopp', 'Water and sewage'),
      exp('U04', 'Sophämtning', 'Waste collection'), exp('U05', 'Reparationer och löpande underhåll', 'Repairs and running maintenance'),
      exp('U06', 'Planerat underhåll', 'Planned maintenance'), exp('U07', 'Fastighetsskötsel och städning', 'Property care and cleaning'),
      exp('U08', 'Försäkringar', 'Insurance'), exp('U09', 'Ekonomisk och teknisk förvaltning', 'Financial and technical management'),
      exp('U10', 'Revision och styrelsearvoden', 'Audit and board fees'), exp('U11', 'Fastighetsavgift och skatt', 'Property fee and tax'),
      exp('U12', 'Räntekostnader', 'Interest expenses'), exp('U13', 'Övriga kostnader', 'Other expenses'),
    ],
  },
  {
    id: 'kultur',
    label: { sv: 'Kultur- och hobbyförening', en: 'Culture and hobby association' },
    desc:  { sv: 'Kör, orkester, teater och intresseföreningar med kurser och evenemang.', en: 'Choirs, orchestras, theatre and interest groups with courses and events.' },
    categories: [
      inc('I01', 'Medlemsavgifter', 'Membership fees'), inc('I02', 'Kurs- och deltagaravgifter', 'Course and participation fees'),
      inc('I03', 'Entré- och biljettintäkter', 'Admission and ticket income'), inc('I04', 'Bidrag och stipendier', 'Grants and scholarships'),
      inc('I05', 'Sponsring och gåvor', 'Sponsorship and donations'), inc('I06', 'Försäljning', 'Sales'), inc('I07', 'Övriga intäkter', 'Other income'),
      exp('U01', 'Lokalhyra', 'Premises rent'), exp('U02', 'Arvoden (ledare, dirigent, instruktörer)', 'Fees (leaders, conductors, instructors)'),
      exp('U03', 'Material och instrument', 'Materials and instruments'), exp('U04', 'Noter, licenser och upphovsrätt', 'Sheet music, licences and copyright'),
      exp('U05', 'Arrangemang och framträdanden', 'Events and performances'), exp('U06', 'Resor', 'Travel'),
      exp('U07', 'Marknadsföring', 'Marketing'), exp('U08', 'Försäkringar', 'Insurance'),
      exp('U09', 'Administration', 'Administration'), exp('U10', 'Övriga kostnader', 'Other expenses'),
    ],
  },
  {
    id: 'scout',
    label: { sv: 'Scoutkår / ungdomsförening', en: 'Scout group / youth association' },
    desc:  { sv: 'Läger, ledarutbildning, scoutgård och bidrag för barn och unga.', en: 'Camps, leader training, scout hall and grants for children and young people.' },
    categories: [
      inc('I01', 'Medlemsavgifter', 'Membership fees'), inc('I02', 'Läger- och deltagaravgifter', 'Camp and participation fees'),
      inc('I03', 'Kommunala bidrag', 'Municipal grants'), inc('I04', 'Statsbidrag och förbundsbidrag', 'State and federation grants'),
      inc('I05', 'Försäljning och insamlingar', 'Sales and fundraising'), inc('I06', 'Sponsring och gåvor', 'Sponsorship and donations'), inc('I07', 'Övriga intäkter', 'Other income'),
      exp('U01', 'Lägerkostnader', 'Camp costs'), exp('U02', 'Lokaler och scoutgård', 'Premises and scout hall'),
      exp('U03', 'Material och utrustning', 'Materials and equipment'), exp('U04', 'Ledarutbildning', 'Leader training'),
      exp('U05', 'Resor och transporter', 'Travel and transport'), exp('U06', 'Förbrukning och fika', 'Supplies and refreshments'),
      exp('U07', 'Försäkringar', 'Insurance'), exp('U08', 'Administration', 'Administration'), exp('U09', 'Övriga kostnader', 'Other expenses'),
    ],
  },
  {
    id: 'samfallighet',
    label: { sv: 'Samfällighet / vägförening', en: 'Property owners’ / road association' },
    desc:  { sv: 'Andelsavgifter, vägunderhåll, snöröjning och belysning.', en: 'Share fees, road maintenance, snow clearing and lighting.' },
    categories: [
      inc('I01', 'Årsavgifter (andelsavgifter)', 'Annual fees (share fees)'), inc('I02', 'Bidrag (t.ex. statsbidrag för enskild väg)', 'Grants (e.g. state grant for private roads)'),
      inc('I03', 'Ränteintäkter', 'Interest income'), inc('I04', 'Övriga intäkter', 'Other income'),
      exp('U01', 'Snöröjning och halkbekämpning', 'Snow clearing and de-icing'), exp('U02', 'Vägunderhåll och grusning', 'Road maintenance and gravelling'),
      exp('U03', 'Belysning och el', 'Lighting and electricity'), exp('U04', 'Skötsel av gemensamma ytor', 'Care of common areas'),
      exp('U05', 'Vatten och avlopp', 'Water and sewage'), exp('U06', 'Försäkringar', 'Insurance'),
      exp('U07', 'Administration och förvaltning', 'Administration and management'), exp('U08', 'Revision', 'Audit'), exp('U09', 'Övriga kostnader', 'Other expenses'),
    ],
  },
  {
    id: 'tom',
    label: { sv: 'Eget upplägg (börja nästan från noll)', en: 'Own setup (start almost from scratch)' },
    desc:  { sv: 'Bara en intäkts- och en kostnadskategori. Lägg till resten själv under Kategorier.', en: 'Just one income and one expense category. Add the rest yourself under Categories.' },
    categories: [inc('I01', 'Intäkter', 'Income'), exp('U01', 'Kostnader', 'Expenses')],
  },
]

export const templateById = id => ORG_TEMPLATES.find(t => t.id === id) || ORG_TEMPLATES[0]

// Kategorier för en mall på valt språk, i det format databasfunktionen tar emot
export const templateCategories = (id, lang) =>
  templateById(id).categories.map(c => ({ id: c.id, type: c.type, name: lang === 'en' ? c.en : c.sv }))
