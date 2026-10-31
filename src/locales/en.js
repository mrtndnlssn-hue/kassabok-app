// Samlar alla engelska översättningar. Nyckeln är den svenska texten.
import auth from './en/auth'
import app from './en/app'
import dashboard from './en/dashboard'
import kassabok from './en/kassabok'
import budget from './en/budget'
import kategorier from './en/kategorier'
import rapporter from './en/rapporter'
import perioder from './en/perioder'
import medlemmar from './en/medlemmar'
import installningar from './en/installningar'
import exporter from './en/exporter'

export default {
  ...auth, ...app, ...dashboard, ...kassabok, ...budget, ...kategorier,
  ...rapporter, ...perioder, ...medlemmar, ...installningar, ...exporter,
}
