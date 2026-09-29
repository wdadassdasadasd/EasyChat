import { app } from 'electron'
import { configureAppIdentity } from './appIdentity.js'

// This module must remain the first main-process import. electron-store reads
// app.getPath('userData') during module initialization.
configureAppIdentity({ app })
