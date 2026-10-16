<script lang="ts">
  import {
    Button,
    IconButton,
    Card,
    Input,
    Select,
    Textarea,
    Toggle,
    Checkbox,
    Radio,
    Skeleton,
  } from '@minion-stack/ui';
  import { PageShell, PageBody, SectionShell, FormField } from '$lib/components/ui/foundations';
  import { PageHeader, EmptyState } from '$lib/components/ui';
  import DataView from '$lib/components/data-view/DataView.svelte';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import BoardView from '$lib/components/data-view/BoardView.svelte';
  import EditableGrid from '$lib/components/dashboard/EditableGrid.svelte';
  import type { DataViewKind } from '$lib/components/data-view/data-view';
  import { setLanguageTag } from '$lib/paraglide/runtime';

  const params = new URLSearchParams(location.search);
  const spanish = params.get('lang') === 'es';
  setLanguageTag(spanish ? 'es' : 'en');
  const recipe = params.get('recipe') ?? 'collection';
  const captureState = params.get('state') ?? 'populated';
  const text = (en: string, es: string) => (spanish ? es : en);
  const title = text(
    'Customer operations and follow-up appointments',
    'Operaciones de clientes y seguimiento de las próximas citas',
  );
  type Row = { id: string; name: string; status: string; owner: string };
  let rows = $state<Row[]>([
    {
      id: 'one',
      name: text(
        'Annual consultation and extended follow-up',
        'Consulta anual y seguimiento personalizado prolongado',
      ),
      status: 'pending',
      owner: 'Ana',
    },
    {
      id: 'two',
      name: text(
        'Review of outstanding documents',
        'Revisión de documentos pendientes de actualización',
      ),
      status: 'done',
      owner: 'Luis',
    },
  ]);
  const columns: DataColumn<Row>[] = [
    { key: 'name', label: text('Name', 'Nombre') },
    { key: 'owner', label: text('Owner', 'Responsable') },
  ];
  let view = $state<DataViewKind>(
    recipe === 'board' ? 'board' : recipe === 'gallery' ? 'gallery' : 'table',
  );
  let selected = $state('');
  let name = $state('');
  let checked = $state(false);
  let radio = $state('one');
  let pressed = $state(false);
  const groups = [
    { id: 'pending', label: text('Waiting for review', 'Pendiente de revisión') },
    { id: 'done', label: text('Completed', 'Completado') },
  ];
  const statusCopy: Record<string, string> = {
    conflict: text(
      'Another person changed this record. Your draft is preserved.',
      'Otra persona cambió este registro. Tu borrador se conserva.',
    ),
    unknown: text(
      'The result is uncertain. Review the current record before a new edit.',
      'El resultado es incierto. Revisa el registro antes de un nuevo cambio.',
    ),
    stale: text(
      'This view changed while the operation was running.',
      'Esta vista cambió mientras se ejecutaba la operación.',
    ),
    'committed-refresh-failed': text(
      'Saved. The updated view could not be loaded. Retry the read only.',
      'Guardado. No se pudo cargar la vista actualizada. Reintenta solo la lectura.',
    ),
    'local-only': text(
      'Layout kept on this device; the shared preference is not confirmed.',
      'Diseño conservado en este dispositivo; la preferencia compartida no está confirmada.',
    ),
    error: text(
      'The data could not be loaded. Your choices are preserved.',
      'No se pudieron cargar los datos. Tus opciones se conservan.',
    ),
  };
</script>

<div class="recipe-root" data-density={params.get('density') ?? 'comfortable'}>
  <PageShell
    archetype={recipe === 'workspace'
      ? 'workspace'
      : recipe === 'form'
        ? 'form'
        : recipe === 'dashboard'
          ? 'dashboard'
          : recipe === 'detail'
            ? 'record-detail'
            : 'collection'}
    scroll="region"
    labelledBy="recipe-title"
  >
    <PageHeader
      titleId="recipe-title"
      {title}
      subtitle={text(
        'Synthetic data · executable composition recipe',
        'Datos ficticios · ejemplo ejecutable de composición',
      )}
    >
      {#snippet primaryActions()}<Button
          variant="primary"
          onclick={() => (selected = text('New task selected', 'Nueva tarea seleccionada'))}
          >{text('New task', 'Nueva tarea')}</Button
        >{/snippet}
    </PageHeader>
    <PageBody padding="compact" scroll="region" width={recipe === 'form' ? 'reading' : 'full'}>
      {#if statusCopy[captureState]}<p role="status" class="state-message">
          {statusCopy[captureState]}
        </p>{/if}
      {#if captureState === 'loading'}
        <Skeleton /><Skeleton />
      {:else if captureState === 'empty'}
        <EmptyState
          title={text('No records yet', 'Aún no hay registros')}
          description={text('Create a task to begin.', 'Crea una tarea para comenzar.')}
        />
      {:else if ['collection', 'board', 'gallery'].includes(recipe)}
        <DataView
          views={['table', 'board', 'gallery']}
          value={view}
          onchange={(next) => (view = next)}
        >
          {#snippet children({ switcher, view: active })}
            <div
              class="recipe-toolbar"
              role="group"
              aria-label={text('Collection views', 'Vistas de la colección')}
            >
              {@render switcher()}
            </div>
            {#if active === 'table'}
              <DataTable
                variant="plain"
                data={rows}
                {columns}
                getRowId={(row) => row.id}
                searchable
                selectable={false}
                interactionMode="grid"
                getRowLabel={(row) => row.name}
                onRowActivate={(row) => (selected = row.name)}
              />
            {:else if active === 'board'}
              <BoardView
                columns={groups}
                {rows}
                columnOf={(row) => row.status}
                rowKey={(row) => row.id}
                rowLabel={(row) => row.name}
                onmove={(row, status) => {
                  rows = rows.map((item) =>
                    item.id === row.id ? { ...item, status: status ?? 'pending' } : item,
                  );
                }}
              >
                {#snippet card(row)}<p class="t-title">{row.name}</p>
                  <p class="t-caption">{row.owner}</p>{/snippet}
              </BoardView>
            {:else}
              <div class="recipe-gallery">
                {#each rows as row (row.id)}<Card
                    ><h2 class="t-title">{row.name}</h2>
                    <p class="t-body">{row.owner}</p>
                    <Button onclick={() => (selected = row.name)}
                      >{text('Open record', 'Abrir registro')}</Button
                    ></Card
                  >{/each}
              </div>
            {/if}
          {/snippet}
        </DataView>
      {:else if recipe === 'dashboard'}
        <EditableGrid
          id="durability-recipe"
          getItemLabel={(id) =>
            ({
              summary: text('Summary', 'Resumen'),
              activity: text('Activity', 'Actividad'),
              notes: text('Notes', 'Notas'),
            })[id] ?? id}
          items={[
            { id: 'summary', w: 2, h: 2 },
            { id: 'activity', w: 2, h: 2 },
            { id: 'notes', w: 1, h: 2 },
          ]}
        >
          {#snippet cell(id)}<Card
              ><h2 class="t-title">{id}</h2>
              <p class="t-body">{title}</p></Card
            >{/snippet}
        </EditableGrid>
      {:else if recipe === 'form'}
        <form
          onsubmit={(event) => {
            event.preventDefault();
            selected = text('Form reviewed', 'Formulario revisado');
          }}
        >
          <FormField
            id="recipe-name"
            label={text('Name', 'Nombre')}
            helper={text(
              'Use the name your team recognizes.',
              'Usa el nombre que reconoce tu equipo.',
            )}
            error={captureState === 'validation-error'
              ? text('Enter a name.', 'Ingresa un nombre.')
              : undefined}
          >
            {#snippet children(control)}<input
                {...control}
                bind:value={name}
                class="recipe-input"
              />{/snippet}
          </FormField>
          <div class="recipe-form-footer">
            <Button type="submit" variant="primary"
              >{text('Save changes', 'Guardar cambios')}</Button
            ><Button type="reset">{text('Cancel', 'Cancelar')}</Button>
          </div>
        </form>
      {:else if recipe === 'detail' || recipe === 'workspace'}
        <SectionShell>
          {#snippet navigation()}<nav
              class="recipe-navigation"
              aria-label={text('Record sections', 'Secciones del registro')}
            >
              <Button>{text('Overview', 'Resumen')}</Button><Button
                >{text('Activity', 'Actividad')}</Button
              >
            </nav>{/snippet}
          <div class="recipe-detail">
            <Card
              ><h2 class="t-heading">{rows[0].name}</h2>
              <p class="t-body">
                {text(
                  'The main task stays in the content region. Context and object actions belong in the inspector.',
                  'La tarea principal permanece en el contenido. El contexto y las acciones del objeto pertenecen al inspector.',
                )}
              </p></Card
            >
            <aside class="recipe-inspector" aria-label={text('Inspector', 'Inspector')}>
              <h2 class="t-title">{text('Record details', 'Detalles del registro')}</h2>
              <p>{rows[0].owner}</p>
              <Button>{text('Edit details', 'Editar detalles')}</Button>
            </aside>
          </div>
        </SectionShell>
      {:else if recipe === 'controls'}
        <div class="control-matrix">
          {#each ['xs', 'sm', 'md', 'lg', 'touch', 'icon'] as size}<Button
              size={size as 'xs' | 'sm' | 'md' | 'lg' | 'touch' | 'icon'}
              data-test={`button-${size}`}>{size}</Button
            >{/each}
          <Button href="#sample" data-test="anchor">Link</Button><Button
            disabled
            data-test="disabled">Disabled</Button
          ><Button loading data-test="busy">Busy</Button>
          <IconButton label="Add">{#snippet icon()}+{/snippet}</IconButton>
          <Input
            label="Input"
            helper="Persistent guidance"
            error="Validation error"
            data-test="input"
          />
          <Select label="Select" options={[{ value: 'one', label: title }]} data-test="select" />
          <Textarea label="Textarea" data-test="textarea" />
          <Toggle label="Toggle" bind:pressed />
          <Checkbox label="Checkbox" bind:checked /><Radio
            label="Radio"
            value="one"
            bind:group={radio}
          />
        </div>
        <div class="type-matrix">
          {#each ['display', 'heading', 'title', 'body', 'label', 'caption', 'mono'] as role}<p
              class={`t-${role}`}
              data-type-role={role}
            >
              {role}: {title}
            </p>{/each}
        </div>
        <button class="unrelated-card-example" data-test="unrelated"
          >Native undecorated control</button
        >
      {/if}
      <p role="status" data-test="selection">{selected}</p>
    </PageBody>
  </PageShell>
</div>

<style>
  .recipe-root {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    min-width: 0;
    background: var(--color-canvas);
    color: var(--color-text-primary);
  }
  .recipe-toolbar,
  .recipe-form-footer,
  .control-matrix {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    margin-block: var(--space-3);
  }
  .recipe-gallery {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: var(--space-4);
  }
  .recipe-detail {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    min-width: 0;
    gap: var(--space-4);
  }
  .recipe-detail > :global(*) {
    flex: 1 1 18rem;
    min-width: 0;
  }
  .recipe-navigation {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .recipe-inspector,
  .state-message {
    padding: var(--space-4);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
  }
  .recipe-input {
    width: 100%;
    min-height: var(--control-height-touch);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  .type-matrix p {
    overflow-wrap: anywhere;
    margin-block: var(--space-3);
  }
  .control-matrix > :global(*) {
    max-width: 100%;
  }
</style>
