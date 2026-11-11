package de.ostash.spur

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.TextButton as M3TextButton

/** Gelbe Schrift auf Weiß ist schlecht lesbar. Gelb nur als Fläche, Schrift immer Anthrazit, etwas größer und fett. */
private val Gelb = Color(0xFFF5C400)
private val Anthrazit = Color(0xFF1B1C1E)

@Composable
fun OutlinedButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, contentPadding: PaddingValues = ButtonDefaults.ContentPadding, content: @Composable RowScope.() -> Unit) {
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        contentPadding = contentPadding,
        colors = ButtonDefaults.buttonColors(containerColor = Gelb, contentColor = Anthrazit, disabledContainerColor = Color(0xFFE6E8EA), disabledContentColor = Color(0xFF8A8F95)),
    ) {
        ProvideTextStyle(TextStyle(fontSize = 17.sp, fontWeight = FontWeight.Bold)) { content() }
    }
}

@Composable
fun TextButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) {
    M3TextButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        colors = ButtonDefaults.textButtonColors(contentColor = Anthrazit, disabledContentColor = Color(0xFF8A8F95)),
    ) {
        ProvideTextStyle(TextStyle(fontSize = 17.sp, fontWeight = FontWeight.Bold)) { content() }
    }
}
