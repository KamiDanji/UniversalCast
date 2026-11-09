package com.universalcast.receiver.discovery

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import java.util.UUID

/**
 * Activity-scoped DNS-SD publisher for the development UCP endpoint.
 *
 * Registration is intentionally tied to the receiver Activity lifecycle in M2.3.
 * The network callback refreshes the advertisement after network changes; NSD
 * registration errors are reported to the UI and never interrupt playback.
 */
class MdnsDiscoveryManager(
    context: Context,
    private val onStatus: (String) -> Unit,
    private val port: Int = DiscoveryAdvertisement.DEFAULT_PORT
) {
    private val appContext = context.applicationContext
    private val nsdManager = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val connectivityManager =
        appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val handler = Handler(Looper.getMainLooper())

    private var started = false
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var networkCallbackRegistered = false
    private var pendingRegistration = false

    private val deviceId: String by lazy {
        val preferences = appContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        preferences.getString(KEY_DEVICE_ID, null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString(KEY_DEVICE_ID, it).apply()
        }
    }

    private val refreshRunnable = Runnable {
        if (started) refreshRegistration()
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            handler.post {
                if (started) {
                    handler.removeCallbacks(refreshRunnable)
                    handler.postDelayed(refreshRunnable, NETWORK_REFRESH_DELAY_MS)
                }
            }
        }

        override fun onLost(network: Network) {
            handler.post {
                if (started) {
                    handler.removeCallbacks(refreshRunnable)
                    handler.postDelayed(refreshRunnable, NETWORK_REFRESH_DELAY_MS)
                }
            }
        }
    }

    fun start() {
        if (started) return
        started = true
        publishStatus("mDNS discovery starting…")
        try {
            connectivityManager.registerNetworkCallback(
                NetworkRequest.Builder()
                    .clearCapabilities()
                    .addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED)
                    .build(),
                networkCallback
            )
            networkCallbackRegistered = true
        } catch (error: Exception) {
            publishStatus("mDNS network monitoring unavailable: ${error.message ?: "unknown error"}")
        }
        registerService()
    }

    fun stop() {
        if (!started && registrationListener == null && !networkCallbackRegistered) return
        started = false
        pendingRegistration = false
        handler.removeCallbacks(refreshRunnable)

        if (networkCallbackRegistered) {
            runCatching { connectivityManager.unregisterNetworkCallback(networkCallback) }
            networkCallbackRegistered = false
        }

        val listener = registrationListener
        registrationListener = null
        if (listener != null) {
            runCatching { nsdManager.unregisterService(listener) }
        }
        publishStatus("mDNS discovery stopped")
    }

    private fun refreshRegistration() {
        val listener = registrationListener
        if (listener == null) {
            registerService()
            return
        }

        pendingRegistration = true
        registrationListener = null
        try {
            nsdManager.unregisterService(listener)
        } catch (error: Exception) {
            pendingRegistration = false
            publishStatus("mDNS refresh failed: ${error.message ?: "unable to unregister"}")
        }
    }

    private fun registerService() {
        if (!started || registrationListener != null) return

        val advertisement = try {
            DiscoveryAdvertisement.androidTv(deviceId).copy(port = port)
        } catch (error: Exception) {
            publishStatus("mDNS configuration error: ${error.message ?: "invalid advertisement"}")
            return
        }

        val serviceInfo = try {
            NsdServiceInfo().apply {
                serviceName = advertisement.serviceName
                serviceType = advertisement.serviceType
                this.port = advertisement.port
                advertisement.txtAttributes.forEach { (key, value) ->
                    setAttribute(key, value)
                }
            }
        } catch (error: Exception) {
            publishStatus("mDNS advertisement could not be created: ${error.message ?: "invalid DNS-SD record"}")
            return
        }

        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) {
                handler.post {
                    if (started) {
                        registrationListener = this
                        publishStatus("mDNS advertising ${serviceInfo.serviceName} on ${advertisement.serviceType} port ${advertisement.port}")
                    } else {
                        runCatching { nsdManager.unregisterService(this) }
                    }
                }
            }

            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                handler.post {
                    if (registrationListener === this) registrationListener = null
                    publishStatus("mDNS registration failed (error $errorCode); UCP remains available by IP")
                }
            }

            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {
                handler.post {
                    if (registrationListener === this) registrationListener = null
                    if (started && pendingRegistration) {
                        pendingRegistration = false
                        registerService()
                    }
                }
            }

            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                handler.post {
                    if (registrationListener === this) registrationListener = null
                    pendingRegistration = false
                    publishStatus("mDNS unregistration failed (error $errorCode)")
                }
            }
        }

        registrationListener = listener
        try {
            nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (error: Exception) {
            if (registrationListener === listener) registrationListener = null
            publishStatus("mDNS registration unavailable: ${error.message ?: "unknown error"}")
        }
    }

    private fun publishStatus(message: String) {
        handler.post { onStatus(message) }
    }

    companion object {
        private const val PREFERENCES_NAME = "universalcast_receiver"
        private const val KEY_DEVICE_ID = "discovery_device_id"
        private const val NETWORK_REFRESH_DELAY_MS = 750L
    }
}
