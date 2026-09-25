package net.nexventures.nfc_terminal

import android.nfc.cardemulation.HostApduService
import android.os.Bundle

/**
 * Phone-as-card (Part 4 §3). Enabled/disabled as a component by the app's sharing
 * toggle; serves the primary card from [ShareCacheStore]. Works while the app is closed.
 */
class CardHostApduService : HostApduService() {
    private var cache: CardCache? = null
    private var cacheLoaded = false

    private val handler = ApduHandler(cacheProvider = {
        if (!cacheLoaded) {
            cache = ShareCacheStore(this).load()
            cacheLoaded = true
        }
        cache
    })

    override fun processCommandApdu(commandApdu: ByteArray?, extras: Bundle?): ByteArray =
        if (commandApdu == null) ApduHandler.SW_WRONG_LENGTH else handler.process(commandApdu)

    override fun onDeactivated(reason: Int) {
        handler.reset()
        // Reload on the next tap so a changed primary card / sign-out takes effect.
        cacheLoaded = false
        cache = null
    }
}
