import { beforeEach,expect,it,vi } from 'vitest'
import { render,screen,fireEvent,waitFor } from '@testing-library/react'
import { AuthContext,type AuthContextValue } from '../contexts/authContext'
import { VisibilityConfigEditor } from '../features/visibility/VisibilityConfigEditor'
import { visibilityConfigRequest } from '../lib/visibilityClient'
import { emptyVisibilityWeek } from '../domain/visibilityConfig'
vi.mock('../lib/visibilityClient',()=>({visibilityConfigRequest:vi.fn()}))
const data=()=>({expectedVersion:1,timezone:'Africa/Abidjan',services:[],weekly:emptyVisibilityWeek(),exceptions:[],offers:[{serviceId:'service',variantId:null,label:'Coupe de recette',priceXof:3000,durationMinutes:30}]})
const saved=vi.fn()
function panel(){return <AuthContext.Provider value={{currentUser:{id:'manager',tenantId:'tenant',isActive:true,role:'manager'}} as AuthContextValue}><VisibilityConfigEditor onSaved={saved}/></AuthContext.Provider>}
beforeEach(()=>vi.resetAllMocks())
it('charge, sélectionne une offre authentique et sauvegarde semaine/exception fermée',async()=>{
 vi.mocked(visibilityConfigRequest).mockResolvedValueOnce(data()).mockResolvedValueOnce({...data(),expectedVersion:2,services:[{serviceId:'service',variantId:null}]})
 render(panel());fireEvent.click(screen.getByText('Charger prestations et horaires'))
 await waitFor(()=>expect(screen.getByLabelText('Lundi')).toBeEnabled())
 fireEvent.click(screen.getByRole('checkbox'))
 fireEvent.change(screen.getByLabelText('Lundi'),{target:{value:'09:00-12:00,14:00-18:00'}})
 fireEvent.click(screen.getByText('Ajouter une exception'));fireEvent.change(screen.getByLabelText('Date exceptionnelle'),{target:{value:'2026-12-25'}})
 fireEvent.click(screen.getByText('Enregistrer prestations et horaires'))
 await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1))
 expect(visibilityConfigRequest).toHaveBeenLastCalledWith(expect.anything(),'save',expect.objectContaining({expectedVersion:1,services:[{serviceId:'service',variantId:null}],exceptions:[{localDate:'2026-12-25',windows:[]}]}))
})
it('validation locale autorise correction sans envoyer d’horaires incohérents',async()=>{
 vi.mocked(visibilityConfigRequest).mockResolvedValue(data());render(panel());fireEvent.click(screen.getByText('Charger prestations et horaires'))
 await waitFor(()=>expect(screen.getByLabelText('Lundi')).toBeEnabled())
 fireEvent.change(screen.getByLabelText('Lundi'),{target:{value:'12:00-09:00'}});fireEvent.click(screen.getByText('Enregistrer prestations et horaires'))
 await screen.findByText('Corrigez les horaires, dates ou doublons avant d’enregistrer.')
 expect(visibilityConfigRequest).toHaveBeenCalledTimes(1)
 expect(screen.getByLabelText('Lundi')).toBeEnabled()
})
it('conflit impose rechargement avant nouvelle sauvegarde',async()=>{
 vi.mocked(visibilityConfigRequest).mockResolvedValueOnce(data()).mockRejectedValueOnce(new Error('Rechargez les deux éditeurs.'))
 render(panel());fireEvent.click(screen.getByText('Charger prestations et horaires'))
 await waitFor(()=>expect(screen.getByLabelText('Lundi')).toBeEnabled())
 fireEvent.click(screen.getByText('Enregistrer prestations et horaires'));await screen.findByText('Rechargez les deux éditeurs.')
 expect(screen.getByLabelText('Lundi')).toBeDisabled()
})
