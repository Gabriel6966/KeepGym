# Limpieza tras la fusión

Requiere autorización vigente para cerrar la publicación y un PR con
`merged: true`, fecha de merge, identidad original y SHA aprobado. Conserva el
SHA que devuelve GitHub en `merge_commit_sha`. Nunca inicies estas escrituras
por un mensaje de éxito de la CLI, una solicitud de auto-merge o un PR cerrado.

## Prueba de merge y sincronización de main

En DRY RUN usa las refs y objetos ya disponibles y la punta remota observada.
Si faltan objetos o la punta local de seguimiento es antigua, declara la
prueba pendiente. En una ejecución real y solo después de confirmar el estado
fusionado, `FETCH_MAIN_EVIDENCE` permite actualizar la referencia de
seguimiento de `main` si faltan objetos o esa ref quedó atrás. Comprueba que
el merge contiene el SHA aprobado y que ambos son ancestros de la punta
remota antes de sincronizar o eliminar.

```sh
git fetch --no-tags --no-recurse-submodules origin refs/heads/main:refs/remotes/origin/main
git merge-base --is-ancestor "$sha" "$merge_sha"
git merge-base --is-ancestor "$sha" refs/remotes/origin/main
git merge-base --is-ancestor "$merge_sha" refs/remotes/origin/main
git merge-base --is-ancestor refs/heads/main refs/remotes/origin/main
```

Si `main` está en un worktree, comprueba que es el checkout de `main`, que su
índice y árbol están limpios, y que no hay operaciones Git en curso. Actualiza
con `git -C "$main_worktree" merge --ff-only --no-overwrite-ignore refs/remotes/origin/main`.
Si `main` no está en ningún worktree, usa
`git fetch --no-tags --no-recurse-submodules . refs/remotes/origin/main:refs/heads/main`
sin forzar la actualización de una rama checked out. Si `main` diverge, está
por delante de `origin/main` o su checkout está ocupado con cambios, para.

Después del fast-forward comprueba igualdad entre la referencia local,
`refs/remotes/origin/main` y la punta actual de GitHub. Repite la comprobación
al cerrar. Si GitHub avanzó durante la limpieza, actualiza de nuevo solo por
fast-forward con la misma prueba de ancestry.

## Borrado acotado

Antes de cualquier borrado, revalida la identidad del PR, puntas de refs e
inventario de worktrees. Si la rama ocupa un checkout ajeno, un worktree
bloqueado o uno propio con cambios, informa el bloqueo. La autorización de
una rama no autoriza desalojar ni eliminar un worktree ajeno.

1. **Remoto.** Si GitHub ya borró la rama, verifica ausencia con `ls-remote` y
   sigue. Si sigue, exige puntualmente el SHA aprobado, permiso de borrado,
   reglas del head satisfechas y ningún otro PR abierto con ese head.
   Usa un único refspec de eliminación y una condición sobre el SHA observado.
   El lease actúa como comparación al borrar esa ref. Esta operación carece de
   refspec de actualización y no publica commits. Si cambia el SHA o GitHub
   rechaza la acción, para. Verifica ausencia otra vez.

   ```sh
   ref="refs/heads/$branch"
   git push --no-follow-tags --recurse-submodules=no \
     --force-with-lease="$ref:$sha" --delete origin "$ref"
   git ls-remote --exit-code --refs origin "$ref"
   ```

2. **Seguimiento local.** Con ausencia remota verificada, si queda
   `refs/remotes/origin/<rama>`, exige que el SHA sea el aprobado o el previo
   registrado y que sea ancestro de `origin/main`. Borra solo esa ref con
   comparación de SHA. Comprueba que desapareció. No hagas prune global de
   remotos.

   ```sh
   git update-ref --no-deref -d "refs/remotes/origin/$branch" "$tracking_sha"
   ```

3. **Rama local.** Comprueba que su ref aún señala el SHA aprobado, este es
   ancestro de `main` y ningún worktree usa ya la rama. Si la retiene el
   worktree temporal propio y está limpio, puedes desacoplar ese worktree
   en el SHA de `main` mediante
   `git -C "$owned_worktree" checkout --detach --no-overwrite-ignore refs/heads/main`.
   Ejecuta el borrado desde el checkout de `main` o desde ese worktree propio
   desacoplado en `main`, con HEAD y ruta comprobados. Si hace falta un checkout
   para ello, `PREPARE_OWN_MAIN_WORKTREE` puede crear uno temporal desacoplado
   con `git worktree add --detach -- "$owned_worktree" refs/heads/main` si el
   alcance lo permite. Registra la ruta antes de crearlo y verifica el resultado.
   Revalida el SHA justo antes de `branch -d`. Conserva las comprobaciones de
   checkout e integración de Git. Si hay operaciones concurrentes sobre la
   rama o los worktrees, detente. Una denegación del borrado seguro es un bloqueo.

   ```sh
   git -C "$main_context" branch -d -- "$branch"
   ```

4. **Worktree propio.** Exige la ruta canónica registrada, un worktree creado
   por esta publicación y ausencia de modificaciones, archivos sin trackear
   y archivos ignorados. Comprueba con
   `git -C "$owned_worktree" --no-optional-locks status --porcelain=v1 -z --ignored=matching --untracked-files=all --ignore-submodules=none`
   y con `git worktree list --porcelain`, incluida ausencia de locks. Ejecuta
   `git worktree remove -- "$owned_worktree"` sin force y desde otro checkout.
   Conserva los worktrees de terceros, las caches, `node_modules`, los perfiles,
   las bases de datos y los volúmenes.

5. **Cierre.** Verifica ausencia de la ref remota, `refs/heads/<rama>`,
   `refs/remotes/origin/<rama>` y la entrada del worktree temporal en la lista.
   Comprueba que `main` sigue sincronizado y contiene ambos SHAs. Si falta
   una prueba, registra `PR MERGED` con la limpieza pendiente y deja el
   registro disponible para reanudar.

Los campos de `cleanup` reflejan observaciones frescas.

- `mainEvidence` vale `FETCH_NEEDED` si falta actualizar la ref de seguimiento
  de `main` u obtener sus objetos para probar el merge. `releaseInMain` y
  `mergeCommitInMain` prueban integración en la punta remota comprobada.
  `releaseInMerge` prueba que el commit de merge contiene el SHA aprobado.
  `trackingInMain` verifica ancestry si la ref de seguimiento todavía apunta
  al SHA anterior.
- `main` vale `CURRENT` si iguala a GitHub y a `origin/main`, `FAST_FORWARD` si
  procede una actualización segura, y `BLOCKED` en los demás casos.
- `worktree` vale `NONE` si no hay worktree temporal ni checkout de la rama,
  `OWN_ATTACHED` si el temporal propio y limpio mantiene la rama,
  `OWN_DETACHED` si está limpio y desacoplado en un commit de `main` que
  contiene el SHA aprobado, o `BLOCKED` si el inventario impide continuar.
- `canDeleteRemote` y `canDeleteLocal` requieren las comprobaciones de cada
  borrado. `canCreateOwnWorktree` requiere una ruta temporal disponible y
  creación autorizada para esta publicación.
- Registra `remoteDeleted`, `trackingDeleted`, `localDeleted` y
  `worktreeRemoved` después de comprobar la ausencia de cada objetivo. Si
  alguno reaparece, detente incluso si tiene el mismo SHA o la misma ruta.
- Si una interrupción dejó sin resultado un borrado, registra su acción en
  `interruptedDeletion`, por ejemplo `DELETE_REMOTE_BRANCH`. Si el objetivo
  está ausente, registra esa observación y reevalúa. Si sigue presente, solo
  puedes retirar el bloqueo con evidencia de que el intento previo no
  ejecutó el borrado. El mismo SHA o ruta por sí solo es insuficiente.

Quedan prohibidos `git reset --hard`, `git clean`, `git branch -D`, los borrados
sin ref concreta, `git worktree remove --force` y los cambios en otros
worktrees. El cleanup nunca se ejecuta dentro de un DRY RUN.

[Refspecs y lease en Git](https://git-scm.com/docs/git-push) ·
[Borrado de ramas locales](https://git-scm.com/docs/git-branch) ·
[Worktrees](https://git-scm.com/docs/git-worktree)
