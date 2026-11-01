import { beforeEach,expect,it,vi } from 'vitest'
import { render,screen,fireEvent,waitFor } from '@testing-library/react'
import { AuthContext,type AuthContextValue } from '../contexts/authContext'
import { TextPublicationPanel } from '../features/visibility/TextPublicationPanel'
import { publishVisibilityTextRequest,visibilityPublicationRequest } from '../lib/visibilityClient'
import { parsePublicationStatus } from '../domain/visibilityPublication'
vi.mock('../lib/visibilityClient',()=>({publishVisibilityTextRequest:vi.fn(),visibilityPublicationRequest:vi.fn()}))
const changed=vi.fn()
const status=()=>({version:2,visibility:'not_visible' as const,publicationRequested:false,publishedRevision:null,canPublish:true,blockers:[]})
function panel(){return <AuthContext.Provider value={{currentUser:{id:'manager',tenantId:'tenant',role:'manager',isActive:true}} as AuthContextValue}><TextPublicationPanel onChanged={changed}/></AuthContext.Provider>}
beforeEach(()=>vi.resetAllMocks())
async function prepare(){
 vi.mocked(visibilityPublicationRequest).mockResolvedValue(status())
 render(panel());expect(screen.getByText('Publier la fiche sans photos')).toBeDisabled()
 fireEvent.click(screen.getByText('Contrôler la publication sans photos'))
 await waitFor(()=>expect(screen.getByRole('checkbox')).toBeEnabled())
 fireEvent.change(screen.getByLabelText('Identifiant public (minuscules, chiffres et tirets)'),{target:{value:'salon-recette'}})
 fireEvent.click(screen.getByRole('checkbox'))
}
it('confirmation, contrôle serveur et identifiant public requis avant envoi',async()=>{
 vi.mocked(publishVisibilityTextRequest).mockResolvedValue({outcome:'published',version:3,revision:1,slug:'salon-recette'})
 await prepare();fireEvent.click(screen.getByText('Publier la fiche sans photos'))
 await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1))
 expect(publishVisibilityTextRequest).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({expectedVersion:2,slug:'salon-recette',confirmedWithoutPhotos:true,idempotencyKey:expect.any(String)}))
 expect(screen.getByText(/Publication textuelle enregistrée/)).toBeInTheDocument()
 expect(screen.getByText('Publier la fiche sans photos')).toBeDisabled()
})
it('réponse incertaine garde exactement la même intention pour le rejeu',async()=>{
 vi.mocked(publishVisibilityTextRequest).mockRejectedValueOnce(new Error('Réseau incertain.')).mockResolvedValueOnce({outcome:'replayed',version:3,revision:1,slug:'salon-recette'})
 await prepare();fireEvent.click(screen.getByText('Publier la fiche sans photos'))
 await screen.findByText('Reprendre la même publication')
 const first=vi.mocked(publishVisibilityTextRequest).mock.calls[0][1]
 expect(screen.getByLabelText('Identifiant public (minuscules, chiffres et tirets)')).toBeDisabled()
 fireEvent.click(screen.getByText('Reprendre la même publication'))
 await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1))
 expect(vi.mocked(publishVisibilityTextRequest).mock.calls[1][1]).toEqual(first)
})
it('refus des droits maintient le bouton fermé et DTO exige cohérence',async()=>{
 vi.mocked(visibilityPublicationRequest).mockResolvedValue({...status(),canPublish:false,blockers:[{code:'DENIED',message:'Abonnement actif requis.'}]})
 render(panel());fireEvent.click(screen.getByText('Contrôler la publication sans photos'))
 await screen.findByText('Abonnement actif requis.')
 expect(screen.getByRole('checkbox')).toBeDisabled()
 expect(screen.getByText('Publier la fiche sans photos')).toBeDisabled()
 expect(parsePublicationStatus(status()).canPublish).toBe(true)
 expect(()=>parsePublicationStatus({...status(),blockers:[{code:'DENIED',message:'Denied'}]})).toThrow()
 expect(()=>parsePublicationStatus({...status(),version:null})).toThrow()
})
