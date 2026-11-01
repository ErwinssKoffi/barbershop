import { beforeEach,expect,it,vi } from 'vitest'
import { render,screen,fireEvent } from '@testing-library/react'
import { AuthContext,type AuthContextValue } from '../contexts/authContext'
import { VisibilityPreviewPanel } from '../features/visibility/VisibilityPreviewPanel'
import { visibilityPreviewRequest } from '../lib/visibilityClient'
import { emptyVisibilityWeek } from '../domain/visibilityConfig'
import { emptyProfileDetails } from '../domain/profileDetails'
import type { VisibilityPreview } from '../domain/visibilityPreview'
vi.mock('../lib/visibilityClient',()=>({visibilityPreviewRequest:vi.fn()}))
const data=():VisibilityPreview=>({version:3,capturedAt:'2026-11-01T12:00:00.000Z',profile:{displayName:'<script>injection</script>',description:'Profil enregistré',city:'Abidjan',commune:'',publicPhone:null,details:emptyProfileDetails()},timezone:'Africa/Abidjan',selectedServiceCount:1,services:[{id:'selected',displayName:'Prestation sauvegardée',description:'',priceXof:4500,durationMinutes:null}],weekly:emptyVisibilityWeek(),exceptions:[{localDate:'2026-12-25',windows:[]}],warnings:[],published:false,onlineBooking:false,media:'not_connected'})
function panel(key='initial'){return <AuthContext.Provider value={{currentUser:{id:'manager',tenantId:'tenant',role:'manager',isActive:true}} as AuthContextValue}><VisibilityPreviewPanel key={key}/></AuthContext.Provider>}
beforeEach(()=>vi.resetAllMocks())
it('charge les seules données enregistrées et affiche prix, semaine, exception et limites',async()=>{
 vi.mocked(visibilityPreviewRequest).mockResolvedValue(data())
 render(panel());expect(screen.queryByText('Prestation sauvegardée')).toBeNull()
 fireEvent.click(screen.getByText('Charger l’aperçu complet'))
 await screen.findByText('Prestation sauvegardée')
 expect(screen.getByText('<script>injection</script>')).toBeInTheDocument();expect(document.querySelector('script')).toBeNull()
 expect(screen.getByText(/Durée non renseignée/)).toBeInTheDocument()
 expect(screen.getByText('Lundi : Fermé')).toBeInTheDocument()
 expect(screen.getByText('2026-12-25 : Fermé')).toBeInTheDocument()
 expect(screen.getByText(/aucune réservation automatique/)).toBeInTheDocument()
 expect(document.querySelector('img')).toBeNull();expect(document.querySelector('a')).toBeNull()
})
it('échec de relecture retire la copie obsolète et affiche le refus',async()=>{
 vi.mocked(visibilityPreviewRequest).mockResolvedValueOnce(data()).mockRejectedValueOnce(new Error('Aperçu refusé.'))
 render(panel());fireEvent.click(screen.getByText('Charger l’aperçu complet'));await screen.findByText('Prestation sauvegardée')
 fireEvent.click(screen.getByText('Charger l’aperçu complet'));await screen.findByText('Aperçu refusé.')
 expect(screen.queryByText('Prestation sauvegardée')).toBeNull()
})
it('sélection invalide annoncée, changement de version invalide l’aperçu',async()=>{
 vi.mocked(visibilityPreviewRequest).mockResolvedValue({...data(),services:[],warnings:['SOURCE_UNAVAILABLE']})
 const view=render(panel());fireEvent.click(screen.getByText('Charger l’aperçu complet'))
 await screen.findByRole('alert')
 expect(screen.getByText(/Certaines prestations sélectionnées/)).toBeInTheDocument()
 view.rerender(panel('version-changed'));expect(screen.queryByRole('article')).toBeNull()
})
