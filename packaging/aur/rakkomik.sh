#!/bin/sh
# Starts RakKomik on the system Electron. The web part is the folder `web` next to app.asar: the application finds
# it there, uses it and does not update it itself, so a new version of the package is what updates it.
exec electron /usr/lib/rakkomik/app.asar "$@"
