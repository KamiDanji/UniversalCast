package com.universalcast.receiver.security

import android.content.Context
import java.util.UUID

/** Stable public receiver identifier for pairing and authentication transcripts. */
class ReceiverIdStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME, Context.MODE_PRIVATE
    )

    @Synchronized
    fun getOrCreate(): String {
        preferences.getString(KEY_RECEIVER_ID, null)?.let { stored ->
            val parsed = runCatching { UUID.fromString(stored) }.getOrNull()
            if (parsed != null && parsed.toString() == stored) return stored
        }
        val id = UUID.randomUUID().toString()
        check(preferences.edit().putString(KEY_RECEIVER_ID, id).commit()) {
            "Unable to persist receiver identity."
        }
        return id
    }

    private companion object {
        const val PREFERENCES_NAME = "ucp_receiver_identity_v1"
        const val KEY_RECEIVER_ID = "receiverId"
    }
}
