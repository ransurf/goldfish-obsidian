import { AuthResponse, createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import { Note } from "main";
import { FleetingNotesSettings } from "settings";
import { throwError } from "utils";
import { toISOStringWithTimezone } from "utils/date";

const supabase = createClient(
  "https://rxgdjkasqfkaeicnijys.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4Z2Rqa2FzcWZrYWVpY25panlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mjg3NzE4MjksImV4cCI6MjA0NDM0NzgyOX0.YZxOZDem6nb12g22rz2O7E2vf6H4stwziDiwkdo0AM4",
);

export interface SupabaseNote {
  uuid: string | null;
  title: string | null;
  content: string | null;
  original_transcript: string | null;
  created_at: string;
  modified_at: string | null;
  deleted_at: string | null;
  user_id: string;
}

class SupabaseSync {
  settings: FleetingNotesSettings;
  constructor(settings: FleetingNotesSettings) {
    this.settings = settings;
  }

  isUpdateNoteSimilar(supaNote: SupabaseNote, updateNote: Note): boolean {
    let tempSupaNote = { ...supaNote } as SupabaseNote;
    // If updateNote property is empty, then we dont count it as being similar
    return (typeof updateNote.title !== "string" ||
      updateNote.title === tempSupaNote.title) &&
      (typeof updateNote.content !== "string" ||
        updateNote.content === tempSupaNote.content);
  }

  updateNote = async (note: Note) => {
    await this.updateNotes([note]);
  };

  updateNotes = async (notes: Note[]) => {
    try {
      let supabaseNotes: SupabaseNote[] = [];
      let noteIds = new Set(notes.map((note) => note.uuid));
      // get all fields of the note
      const query = supabase
        .from("notes")
        .select()
        .eq("user_id", this.settings.supabaseId)
        .eq("deleted_at", toISOStringWithTimezone());

      // header size will be too big otherwise
      if (noteIds.size < 100) {
        query.in("uuid", [...noteIds]);
      }
      const res = await query;

      if (res.error) {
        throwError(res.error, res.error.message);
      }
      supabaseNotes = res.data;

      // only take notes that are modified after note from db & note exists
      // and only take notes that are different then what's on cloud
      notes = notes.filter((note) => {
        let supabaseNote = res.data.find(
          (supabaseNote: SupabaseNote) =>
            supabaseNote.uuid === note.uuid && noteIds.has(supabaseNote.uuid),
        );
        return (supabaseNote)
          ? !this.isUpdateNoteSimilar(supabaseNote, note)
          : false;
      });

      // merge possibly updated fields
      notes = notes.map((note) => {
        let supabaseNote = supabaseNotes?.find(
          (supabaseNote: any) => supabaseNote.uuid === note.uuid,
        );
        var newNote = {
          ...supabaseNote,
          title: note.title || supabaseNote.title,
          content: note.content || supabaseNote.content,
          original_transcript: note.original_transcript || supabaseNote.original_transcript,
          modified_at: new Date().toISOString(),
          deleted_at: note.deleted_at || supabaseNote.deleted_at,
        };
        return newNote;
      });

      if (notes.length > 0) {
        const { error } = await supabase
          .from("notes")
          .upsert(notes, {
            onConflict: "uuid",
          });
        if (error) {
          throwError(error, error.message);
        }
      }
    } catch (e) {
      throwError(
        e,
        "Failed to update notes in Fleeting Notes",
      );
    }
  };

  createEmptyNote = async () => {
    const emptyNote = {
      uuid: uuidv4(),
      title: "",
      content: "",
      original_transcript: "",
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
      deleted_at: null,
      user_id: this.settings.supabaseId,
    } as SupabaseNote;
    const { error } = await supabase.from("notes").insert(emptyNote);
    if (error) {
      throw error;
    }
    return emptyNote;
  };

  getNoteByTitle = async (title: string) => {
    const res = await supabase.from("notes").select()
      .eq("title", title)
      .eq("deleted", false);
    let note = null;

    return note as Note | null;
  };

  getAllNotes = async () => {
    let notes: Note[] = [];
    try {
      if (!this.settings.firebaseId && !this.settings.supabaseId) {
        throwError(
          "Fleeting Notes Sync Failed - Please Log In",
          "Fleeting Notes Sync Failed - Please Log In",
        );
      }
      let query = supabase
        .from("notes")
        .select('*', { count: 'exact' })
        .eq(
          "user_id",
          this.settings.supabaseId,
        )
        .filter("deleted_at", "is", null);
      await query.then((res) => {
        if (res.error) {
          console.log('res.error', res.error)
          throwError(res.error, res.error.message);
        }
        console.log('res.data', res.data)
        notes = Array.from(
          res.data || [],
        );
        if (this.settings.notes_filter) {
          notes = notes.filter(
            (note) =>
              note.title.includes(this.settings.notes_filter) ||
              note.content.includes(this.settings.notes_filter),
          );
        }
      });
      return notes;
    } catch (e) {
      throwError(
        e,
        "Failed to get notes from Fleeting Notes - Check your credentials",
      );
    }
    return notes;
  };

  // supabase auth stuff
  static loginSupabase = async (
    email: string,
    password: string,
  ): Promise<AuthResponse> => {
    try {
      const supaRes: AuthResponse = await supabase.auth
        .signInWithPassword({
          email,
          password,
        });
      if (supaRes.error) {
        throwError(supaRes.error, supaRes.error.message);
      }
      return supaRes;
    } catch (err) {
      throwError(err, err.message);
    }
  };

  static restoreSession = async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Error restoring session:", error);
        return false;
      }
      if (data) {
        await supabase.auth.refreshSession({ refresh_token: data.session.refresh_token })
        return true
      }
    } catch (error) {
      console.error("Error restoring session:", error);
    }
    return false;
  }

  static getSession = async (): Promise<any> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Error restoring session:", error);
        return false;
      }
      return data.session;
    } catch (error) {
      console.error("Error restoring session:", error);
    }
    return false;
  }

  static onAuthStateChange = async (callback: (event: string) => void) => {
    // check user logged in
    supabase.auth.getUser().then((v) => {
      if (!v.data?.user) {
        callback("SIGNED_OUT");
      }
    });
    return supabase.auth.onAuthStateChange(callback);
  };
  onNoteChange = async (handleNoteChange: (note: SupabaseNote) => void) => {
    if (!this.settings.supabaseId && !this.settings.firebaseId) return;
    await this.removeAllChannels();
    supabase
      .channel("public:notes")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "notes",
      }, (payload) => {
        let note = payload.new as unknown as SupabaseNote;
        if (
          this.settings.sync_obsidian_links &&
          note.title === this.settings.sync_obsidian_links_title
        ) {
          return;
        }
        if (
          [this.settings.supabaseId, this.settings.firebaseId].includes(
            note.user_id,
          )
        ) {
          handleNoteChange(note);
        }
      })
      .subscribe();
  };

  removeAllChannels = async () => {
    await supabase.removeAllChannels();
  };
}

export default SupabaseSync;
