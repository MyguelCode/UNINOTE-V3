/**
 * SearchService - Búsqueda local y global de notas
 */

import { STATE } from '../config/state.js';

export class SearchService {

  /**
   * Búsqueda local en el documento actual
   */
  static performLocalSearch(searchTerm) {
    const notesList = STATE.DOM.notesList;
    const searchResultsCounter = STATE.DOM.searchResultsCounter;

    // Limpiar búsqueda anterior
    this.clearSearchHighlights();
    notesList.querySelectorAll('.note').forEach(n => n.classList.remove('is-filtered'));

    if (!searchTerm) {
      searchResultsCounter.style.display = 'none';
      return;
    }

    const notesToShow = new Set();
    const notesWithMatches = new Set(); // Solo notas que realmente contienen el término
    const searchLower = searchTerm.toLowerCase();
    let totalMatches = 0;
    let firstMatchNote = null;

    // Crear regex para resaltado (escapar caracteres especiales)
    const regex = new RegExp(`(${searchTerm.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');

    const recursiveSearch = (list) => {
      list.querySelectorAll(':scope > .note').forEach(note => {
        if (note.dataset.isArchived === 'true') return;

        let noteText;
        const isNoteLocked = note.dataset.lockType && !STATE.sessionUnlockedNotes.has(note.dataset.id);
        const editableDiv = note.querySelector('.editable-note');

        if (isNoteLocked) {
          noteText = (note.dataset.lockHint || '').toLowerCase();
        } else {
          noteText = editableDiv ? editableDiv.textContent.toLowerCase() : '';
        }

        if (noteText.includes(searchLower)) {
          notesToShow.add(note);
          notesWithMatches.add(note);

          // Resaltar coincidencias en el contenido
          if (!isNoteLocked && editableDiv) {
            const originalHTML = editableDiv.innerHTML;
            const textContent = editableDiv.textContent;

            // Contar coincidencias en esta nota
            const matches = textContent.match(regex);
            if (matches) {
              totalMatches += matches.length;

              // Guardar el primer match para scroll
              if (!firstMatchNote) {
                firstMatchNote = note;
              }

              // Aplicar resaltado
              // Para evitar problemas con HTML existente, trabajamos solo con texto plano
              const tempDiv = document.createElement('div');
              tempDiv.textContent = textContent;
              const plainText = tempDiv.textContent;
              const highlightedText = plainText.replace(regex, '<mark class="search-highlight">$1</mark>');
              editableDiv.innerHTML = highlightedText;
            }
          }

          // Agregar todos los padres
          let parent = note.parentElement.closest('.note');
          while (parent) {
            notesToShow.add(parent);
            parent = parent.parentElement.closest('.note');
          }
        }

        const sublist = note.querySelector('.subnotes');
        if (sublist) {
          recursiveSearch(sublist);
        }
      });
    };

    recursiveSearch(notesList);

    // Filtrar notas
    notesList.querySelectorAll('.note').forEach(note => {
      if (note.dataset.isArchived === 'true') return;
      note.classList.toggle('is-filtered', !notesToShow.has(note));
    });

    // Mostrar contador de resultados
    if (notesWithMatches.size > 0) {
      searchResultsCounter.textContent = `🔍 ${totalMatches} coincidencia${totalMatches !== 1 ? 's' : ''} en ${notesWithMatches.size} nota${notesWithMatches.size !== 1 ? 's' : ''}`;
      searchResultsCounter.style.display = 'block';

      // Scroll automático al primer resultado
      if (firstMatchNote) {
        setTimeout(() => {
          firstMatchNote.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstMatchNote.classList.add('highlight');
          setTimeout(() => firstMatchNote.classList.remove('highlight'), 2000);
        }, 100);
      }
    } else {
      searchResultsCounter.textContent = '🔍 No se encontraron resultados';
      searchResultsCounter.style.display = 'block';
    }
  }

  /**
   * Limpiar resaltados de búsqueda
   */
  static clearSearchHighlights() {
    const notesList = STATE.DOM.notesList;
    notesList.querySelectorAll('.search-highlight').forEach(mark => {
      const parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize(); // Combinar nodos de texto adyacentes
    });
  }

  /**
   * Búsqueda global en todos los documentos
   */
  static async performGlobalSearch(searchTerm) {
    const notesList = STATE.DOM.notesList;
    const archiveViewContainer = STATE.DOM.archiveViewContainer;
    const globalSearchResults = STATE.DOM.globalSearchResults;

    notesList.classList.add('hidden');
    archiveViewContainer.classList.add('hidden');
    globalSearchResults.classList.remove('hidden');
    globalSearchResults.innerHTML = '<li class="search-no-results">Buscando en todos los Uninotes accesibles...</li>';

    let allResults = [];
    const tempDiv = document.createElement('div');
    const searchLower = searchTerm.toLowerCase();

    for (const docName of STATE.appData.documents) {
      if (STATE.appData.documentPasswords[docName] && !STATE.unlockedDocuments.has(docName)) {
        continue;
      }

      // Cargar desde IndexedDB
      let notesData;
      if (window.isUsingIndexedDB && window.isUsingIndexedDB()) {
        notesData = await window.loadDocumentAsync(docName);
      } else {
        const notesDataRaw = localStorage.getItem(`uninote_doc_${docName}`);
        notesData = notesDataRaw ? JSON.parse(notesDataRaw) : null;
      }

      if (!notesData) continue;

      const recursiveSearch = (notes) => {
        for (const note of notes) {
          if (note.isArchived) continue;
          const isNoteLocked = note.lockType && !STATE.sessionUnlockedNotes.has(note.id);
          let textToSearch = isNoteLocked ? (note.lockHint || '') : note.content;
          tempDiv.innerHTML = textToSearch;
          textToSearch = (tempDiv.textContent || tempDiv.innerText || "").toLowerCase();

          if (textToSearch.includes(searchLower)) {
            allResults.push({ note, docName });
          }

          if (note.children && !isNoteLocked) {
            recursiveSearch(note.children);
          }
        }
      };
      recursiveSearch(notesData);
    }

    this.renderGlobalResults(allResults, searchTerm);
  }

  /**
   * Renderizar resultados de búsqueda global
   */
  static renderGlobalResults(results, searchTerm) {
    const globalSearchResults = STATE.DOM.globalSearchResults;
    const searchResultsCounter = STATE.DOM.searchResultsCounter;
    globalSearchResults.innerHTML = '';

    if (results.length === 0) {
      globalSearchResults.innerHTML = '<li class="search-no-results">No se encontraron resultados.</li>';
      searchResultsCounter.textContent = '🔍 No se encontraron resultados';
      searchResultsCounter.style.display = 'block';
      return;
    }

    const regex = new RegExp(`(${searchTerm.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
    const tempDiv = document.createElement('div');
    let totalMatches = 0;

    results.forEach(result => {
      const li = document.createElement('li');
      li.className = 'search-result-item';
      li.dataset.docName = result.docName;
      li.dataset.noteId = result.note.id;
      tempDiv.innerHTML = result.note.content;
      let plainText = tempDiv.textContent || tempDiv.innerText || "";

      // Contar coincidencias
      const matches = plainText.match(regex);
      if (matches) {
        totalMatches += matches.length;
      }

      let highlightedText = plainText.replace(regex, '<mark>$1</mark>');
      li.innerHTML = `
        <p class="result-content">${highlightedText}</p>
        <p class="result-location">en: ${result.docName}</p>
      `;
      globalSearchResults.appendChild(li);
    });

    // Mostrar contador de resultados globales
    searchResultsCounter.textContent = `🔍 ${totalMatches} coincidencia${totalMatches !== 1 ? 's' : ''} en ${results.length} nota${results.length !== 1 ? 's' : ''} (búsqueda global)`;
    searchResultsCounter.style.display = 'block';
  }

  /**
   * Ocultar resultados de búsqueda global
   */
  static hideGlobalSearchResults() {
    STATE.DOM.globalSearchResults.classList.add('hidden');
    STATE.DOM.searchResultsCounter.style.display = 'none';
  }
}
